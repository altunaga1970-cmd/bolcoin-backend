/**
 * Keno On-Chain Event Indexer
 *
 * Polls KenoGame.sol contract events via getLogs and persists resolved
 * bets into the keno_games table so they appear in GET /keno/history.
 *
 * Uses getLogs polling (not eth_newFilter) — Polygon Amoy RPC does not
 * support eth_getFilterChanges.
 *
 * Event indexed:
 *   BetResolved → keno_games INSERT
 *     After event, calls bets(betId) on-chain to get selectedBitmap,
 *     drawnBitmap, spots, amount — needed for the full history row.
 *
 * Env vars required:
 *   KENO_CONTRACT_ADDRESS   — deployed KenoGame address
 *   POLYGON_RPC_URL | RPC_URL — JSON-RPC endpoint
 */

const { ethers } = require('ethers');
const { query } = require('../config/database');
const { loadIndexerBlock, saveIndexerBlock } = require('../db/indexerState');
const { calculateBetCommissionByWallet } = require('./referralAdminService');

// Minimal ABI — only events + bets() public mapping needed for indexing
const ABI = [
  // Events
  'event BetResolved(uint256 indexed betId, address indexed user, uint8 hits, uint256 payout, bool paid)',
  // View functions
  'function bets(uint256 betId) view returns (address user, uint128 amount, uint128 payout, uint8 spots, uint8 hits, uint256 selectedBitmap, uint256 drawnBitmap, uint8 status)',
];

const TOKEN_DECIMALS = 6;

/**
 * Parse a uint256 bitmap into an array of Keno numbers (1–80).
 * Bit position i (1-based) represents number i: (bitmap >> i) & 1.
 * This matches the frontend useKenoContract.parseBitmap implementation.
 */
function parseBitmap(bitmap) {
  const nums = [];
  const bn = BigInt(bitmap);
  for (let i = 1; i <= 80; i++) {
    if ((bn >> BigInt(i)) & 1n) nums.push(i);
  }
  return nums;
}

class KenoIndexer {
  constructor() {
    this.contract = null;
    this.provider = null;
    this.isRunning = false;
    this.pollTimer = null;
    this.lastBlockProcessed = 0;
    this.pollingInterval = 12000; // 12 s — ~1 Polygon block
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async init() {
    const contractAddress = process.env.KENO_CONTRACT_ADDRESS;
    const rpcUrl = process.env.POLYGON_RPC_URL || process.env.RPC_URL;

    if (!contractAddress || !rpcUrl) {
      console.log('[KenoIndexer] Missing KENO_CONTRACT_ADDRESS or RPC_URL — skipping');
      return false;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.contract = new ethers.Contract(contractAddress, ABI, this.provider);
      this._contractAddress = contractAddress;
      console.log(`[KenoIndexer] Initialized — contract ${contractAddress}`);
      return true;
    } catch (err) {
      console.error('[KenoIndexer] Failed to initialize:', err.message);
      return false;
    }
  }

  async start() {
    if (!this.contract) {
      const ok = await this.init();
      if (!ok) return;
    }
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const saved = await loadIndexerBlock('keno');
      if (saved !== null) {
        this.lastBlockProcessed = saved;
        console.log(`[KenoIndexer] Resuming from block ${saved} (DB state)`);
      } else {
        const currentBlock = await this.provider.getBlockNumber();
        this.lastBlockProcessed = Math.max(0, currentBlock - 200);
        console.log(`[KenoIndexer] No DB state — starting from block ${this.lastBlockProcessed}`);
      }
    } catch (_) {
      this.lastBlockProcessed = 0;
    }

    this._schedulePoll();
    console.log('[KenoIndexer] Event polling active');
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    console.log('[KenoIndexer] Stopped');
  }

  // ── Polling ──────────────────────────────────────────────────────────

  _schedulePoll() {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(() => this._poll(), this.pollingInterval);
  }

  async _poll() {
    if (!this.isRunning) return;
    try {
      const currentBlock = await this.provider.getBlockNumber();
      if (currentBlock > this.lastBlockProcessed) {
        const logs = await this.provider.getLogs({
          address: this._contractAddress,
          fromBlock: this.lastBlockProcessed + 1,
          toBlock: currentBlock,
        });
        for (const log of logs) {
          try {
            const parsed = this.contract.interface.parseLog(log);
            if (parsed && parsed.name === 'BetResolved') {
              await this._indexBetResolved(parsed.args, log.transactionHash);
            }
          } catch (_) { /* skip non-matching logs */ }
        }
        this.lastBlockProcessed = currentBlock;
        await saveIndexerBlock('keno', currentBlock);
      }
    } catch (err) {
      console.error('[KenoIndexer] Poll error:', err.message);
    }
    this._schedulePoll();
  }

  // ── Indexing ─────────────────────────────────────────────────────────

  /**
   * Index a resolved Keno bet into keno_games.
   *
   * BetResolved event args: betId, user, hits, payout, paid
   *
   * We call bets(betId) to get the full struct (bitmaps, amount, spots)
   * so the history row has all the fields needed for display.
   */
  async _indexBetResolved(args, txHash) {
    const betId = Number(args.betId);
    const userAddress = args.user.toLowerCase();
    const payoutUsdt = parseFloat(ethers.formatUnits(args.payout, TOKEN_DECIMALS));

    const gameId = `KENO-CHAIN-${betId}`;

    // Already indexed?  Skip (idempotent on backfill / re-org)
    try {
      const existing = await query(
        'SELECT game_id FROM keno_games WHERE game_id = $1',
        [gameId]
      );
      if (existing.rows.length > 0) return;
    } catch (err) {
      console.warn(`[KenoIndexer] Could not check existing for betId=${betId}:`, err.message);
    }

    // Fetch full bet struct from contract (selectedBitmap, drawnBitmap, spots, amount)
    let selectedNumbers = [];
    let drawnNumbers = [];
    let matchedNumbers = [];
    let spots = 0;
    let hits = Number(args.hits);
    let betAmountUsdt = 0;

    try {
      const bet = await this.contract.bets(betId);
      betAmountUsdt = parseFloat(ethers.formatUnits(bet.amount, TOKEN_DECIMALS));
      spots = Number(bet.spots);
      hits  = Number(bet.hits);
      selectedNumbers = parseBitmap(bet.selectedBitmap);
      drawnNumbers    = parseBitmap(bet.drawnBitmap);
      matchedNumbers  = selectedNumbers.filter(n => drawnNumbers.includes(n));
    } catch (err) {
      console.error(`[KenoIndexer] Error reading bet struct #${betId}:`, err.message);
      // Still insert with partial data from event — better than dropping the row
    }

    const netResult  = payoutUsdt - betAmountUsdt;
    const multiplier = betAmountUsdt > 0 && payoutUsdt > 0
      ? Math.round((payoutUsdt / betAmountUsdt) * 100) / 100
      : 0;

    // seed = tx hash (hex, no 0x, padded to 64 chars)
    const seed = (txHash || '')
      .replace('0x', '')
      .padEnd(64, '0')
      .slice(0, 64);

    try {
      await query(`
        INSERT INTO keno_games (
          game_id, wallet_address,
          selected_numbers, drawn_numbers, matched_numbers,
          spots, hits, bet_amount, multiplier, payout, net_result,
          seed, settled, settled_at, timestamp, vrf_verified
        ) VALUES (
          $1, $2,
          $3::jsonb, $4::jsonb, $5::jsonb,
          $6, $7, $8, $9, $10, $11,
          $12, true, NOW(), NOW(), true
        )
        ON CONFLICT (game_id) DO NOTHING
      `, [
        gameId, userAddress,
        JSON.stringify(selectedNumbers),
        JSON.stringify(drawnNumbers),
        JSON.stringify(matchedNumbers),
        spots, hits,
        betAmountUsdt, multiplier, payoutUsdt, netResult,
        seed,
      ]);

      // Comision de referido (fire-and-forget, no bloquea el indexer)
      calculateBetCommissionByWallet(gameId, userAddress, betAmountUsdt).catch(() => {});

      console.log(
        `[KenoIndexer] Indexed betId=${betId} user=${userAddress} ` +
        `hits=${hits}/${spots} payout=${payoutUsdt} USDT`
      );
    } catch (err) {
      console.error(`[KenoIndexer] DB error for betId=${betId}:`, err.message);
    }
  }

  // ── Backfill ─────────────────────────────────────────────────────────

  /**
   * Backfill all historical BetResolved events from a given block.
   * Call once manually (or via a script) to populate history for games
   * that happened before the indexer was running.
   *
   *   const { kenoIndexer } = require('./src/services/kenoIndexer');
   *   await kenoIndexer.backfill(0);   // from genesis
   */
  async backfill(fromBlock = 0) {
    if (!this.contract) {
      const ok = await this.init();
      if (!ok) return;
    }

    console.log(`[KenoIndexer] Backfilling BetResolved from block ${fromBlock}...`);
    try {
      const filter = this.contract.filters.BetResolved();
      const logs = await this.contract.queryFilter(filter, fromBlock);
      console.log(`[KenoIndexer] ${logs.length} BetResolved events to backfill`);

      for (const log of logs) {
        const parsed = this.contract.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        await this._indexBetResolved(parsed.args, log.transactionHash);
      }
    } catch (err) {
      console.error('[KenoIndexer] Backfill error:', err.message);
    }

    console.log('[KenoIndexer] Backfill complete');
  }
}

// Singleton
const kenoIndexer = new KenoIndexer();

module.exports = { kenoIndexer, KenoIndexer };
