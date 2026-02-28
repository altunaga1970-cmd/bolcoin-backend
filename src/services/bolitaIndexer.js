/**
 * La Bolita Event Indexer
 *
 * Polls LaBolitaGame.sol contract events via getLogs and indexes them in PostgreSQL
 * for fast API queries and admin dashboard.
 *
 * Uses getLogs polling (not contract.on / eth_newFilter) — Polygon Amoy RPC
 * does not support eth_getFilterChanges.
 *
 * Events indexed:
 *   - BetPlaced → bets table
 *   - DrawCreated/Opened/Closed → draws table
 *   - DrawResolved → draws table + bet payouts
 *   - DrawCancelled → draws table + refunds
 *   - BetPaid/BetUnpaid/BetRefunded → bets table
 */

const { ethers } = require('ethers');
const { getClient, query } = require('../config/database');

const ABI = [
  'event DrawCreated(uint256 indexed drawId, string drawNumber, uint256 scheduledTime)',
  'event DrawOpened(uint256 indexed drawId)',
  'event DrawClosed(uint256 indexed drawId, uint256 vrfRequestId)',
  'event DrawResolved(uint256 indexed drawId, uint16 winningNumber, uint256 totalPaidOut)',
  'event DrawCancelled(uint256 indexed drawId, uint256 refundedAmount)',
  'event BetPlaced(uint256 indexed betId, uint256 indexed drawId, address indexed player, uint8 betType, uint16 number, uint256 amount)',
  'event BetResolved(uint256 indexed betId, address indexed player, bool won, uint256 payout)',
];

const TOKEN_DECIMALS = 6;
const BET_TYPES = ['fijos', 'centenas', 'parles'];
const DRAW_STATUSES = ['created', 'open', 'closed', 'vrf_pending', 'vrf_fulfilled', 'resolved', 'cancelled'];

class BolitaIndexer {
  constructor() {
    this.contract = null;
    this.provider = null;
    this.isRunning = false;
    this.pollTimer = null;
    this.lastBlockProcessed = 0;
    this.pollingInterval = 12000; // 12s
  }

  /**
   * Initialize the indexer
   */
  async init() {
    const contractAddress = process.env.BOLITA_CONTRACT_ADDRESS;
    const rpcUrl = process.env.POLYGON_RPC_URL || process.env.RPC_URL;

    if (!contractAddress || !rpcUrl) {
      console.log('[BolitaIndexer] Missing BOLITA_CONTRACT_ADDRESS or RPC_URL, skipping initialization');
      return false;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.contract = new ethers.Contract(contractAddress, ABI, this.provider);
      console.log(`[BolitaIndexer] Initialized for contract ${contractAddress}`);
      return true;
    } catch (error) {
      console.error('[BolitaIndexer] Failed to initialize:', error.message);
      return false;
    }
  }

  /**
   * Start polling for events
   */
  async start() {
    if (!this.contract) {
      const ok = await this.init();
      if (!ok) return;
    }

    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[BolitaIndexer] Starting event polling (getLogs)...');

    // Seed lastBlockProcessed from current chain tip — only index new events from here
    try {
      this.lastBlockProcessed = await this.provider.getBlockNumber();
    } catch (_) {
      this.lastBlockProcessed = 0;
    }

    this._schedulePoll();

    console.log('[BolitaIndexer] Event polling active');
  }

  /**
   * Stop polling
   */
  stop() {
    this.isRunning = false;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    console.log('[BolitaIndexer] Stopped');
  }

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
          address: process.env.BOLITA_CONTRACT_ADDRESS,
          fromBlock: this.lastBlockProcessed + 1,
          toBlock: currentBlock,
        });
        for (const log of logs) {
          try {
            const parsed = this.contract.interface.parseLog(log);
            if (parsed) await this._dispatch(parsed);
          } catch (_) { /* skip non-matching logs */ }
        }
        this.lastBlockProcessed = currentBlock;
      }
    } catch (err) {
      console.error('[BolitaIndexer] Poll error:', err.message);
    }
    this._schedulePoll();
  }

  async _dispatch(parsed) {
    const { name, args } = parsed;
    try {
      if (name === 'DrawCreated')
        await this._indexDrawCreated(args[0], args[1], args[2]);
      else if (name === 'DrawOpened')
        await this._updateDrawStatus(args[0], 'open');
      else if (name === 'DrawClosed')
        await this._updateDrawStatus(args[0], 'closed');
      else if (name === 'DrawResolved')
        await this._indexDrawResolved(args[0], args[1], args[2]);
      else if (name === 'DrawCancelled')
        await this._indexDrawCancelled(args[0], args[1]);
      else if (name === 'BetPlaced')
        await this._indexBetPlaced(args[0], args[1], args[2], args[3], args[4], args[5]);
      else if (name === 'BetResolved')
        await this._indexBetResolved(args[0], args[1], args[2], args[3]);
    } catch (err) {
      console.error(`[BolitaIndexer] Error dispatching ${name}:`, err.message);
    }
  }

  // ── Internal indexing methods ──

  async _indexDrawCreated(drawId, drawNumber, scheduledTime) {
    const id = Number(drawId);
    const time = new Date(Number(scheduledTime) * 1000);

    await query(`
      INSERT INTO draws (id, draw_number, scheduled_time, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'scheduled', NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        draw_number = $2,
        scheduled_time = $3,
        updated_at = NOW()
    `, [id, drawNumber, time]);

    console.log(`[BolitaIndexer] DrawCreated #${id}: ${drawNumber} at ${time.toISOString()}`);
  }

  async _updateDrawStatus(drawId, status) {
    const id = Number(drawId);
    await query(`
      UPDATE draws SET status = $1, updated_at = NOW()
      WHERE id = $2
    `, [status, id]);

    console.log(`[BolitaIndexer] Draw #${id} status -> ${status}`);
  }

  async _indexDrawResolved(drawId, winningNumber, totalPaidOut) {
    const id = Number(drawId);
    const paidOut = parseFloat(ethers.formatUnits(totalPaidOut, TOKEN_DECIMALS));

    await query(`
      UPDATE draws SET
        status = 'completed',
        total_paid_out = $1,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `, [paidOut, id]);

    console.log(`[BolitaIndexer] DrawResolved #${id}: paid out ${paidOut} USDT`);
  }

  async _indexDrawCancelled(drawId, refundedAmount) {
    const id = Number(drawId);
    const refunded = parseFloat(ethers.formatUnits(refundedAmount, TOKEN_DECIMALS));

    await query(`
      UPDATE draws SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Mark all pending bets as refunded
    await query(`
      UPDATE bets SET status = 'refunded', updated_at = NOW()
      WHERE draw_id = $1 AND status = 'pending'
    `, [id]);

    console.log(`[BolitaIndexer] DrawCancelled #${id}: refunded ${refunded} USDT`);
  }

  async _indexBetPlaced(betId, drawId, player, betType, number, amount) {
    const betIdNum = Number(betId);
    const drawIdNum = Number(drawId);
    const gameType = BET_TYPES[Number(betType)] || 'fijos';
    const numStr = String(Number(number)).padStart(
      gameType === 'fijos' ? 2 : gameType === 'centenas' ? 3 : 4,
      '0'
    );
    const amountUsdt = parseFloat(ethers.formatUnits(amount, TOKEN_DECIMALS));
    const userAddr = player.toLowerCase();

    // Look up user ID
    const userResult = await query(
      'SELECT id FROM users WHERE wallet_address = $1',
      [userAddr]
    );
    const userId = userResult.rows[0]?.id;

    if (!userId) {
      console.warn(`[BolitaIndexer] Unknown user ${userAddr}, skipping bet index`);
      return;
    }

    // Calculate potential payout
    const multipliers = { fijos: 65, centenas: 300, parles: 1000 };
    const multiplier = multipliers[gameType] || 65;
    const potentialPayout = Math.round(amountUsdt * multiplier * 100) / 100;

    await query(`
      INSERT INTO bets (
        user_id, draw_id, game_type, bet_number, amount,
        potential_payout, multiplier, status, chain_bet_index, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW())
      ON CONFLICT DO NOTHING
    `, [userId, drawIdNum, gameType, numStr, amountUsdt, potentialPayout, multiplier, betIdNum]);

    console.log(`[BolitaIndexer] BetPlaced: betId=${betIdNum} draw=${drawIdNum} user=${userAddr} ${gameType}:${numStr} ${amountUsdt} USDT`);
  }

  async _indexBetResolved(betId, player, won, payout) {
    const betIdNum = Number(betId);
    const payoutUsdt = parseFloat(ethers.formatUnits(payout, TOKEN_DECIMALS));
    const status = won ? 'won' : 'lost';

    await query(`
      UPDATE bets SET
        status = $1,
        payout_amount = $2,
        updated_at = NOW()
      WHERE chain_bet_index = $3
    `, [status, payoutUsdt, betIdNum]);

    console.log(`[BolitaIndexer] BetResolved: betId=${betIdNum} won=${won} payout=${payoutUsdt} USDT`);
  }

  /**
   * Backfill historical events from a starting block
   */
  async backfill(fromBlock = 0) {
    if (!this.contract) {
      const ok = await this.init();
      if (!ok) return;
    }

    console.log(`[BolitaIndexer] Backfilling from block ${fromBlock}...`);

    const events = [
      'DrawCreated', 'DrawOpened', 'DrawClosed',
      'DrawResolved', 'DrawCancelled',
      'BetPlaced', 'BetResolved'
    ];

    for (const eventName of events) {
      try {
        const filter = this.contract.filters[eventName]();
        const logs = await this.contract.queryFilter(filter, fromBlock);
        console.log(`[BolitaIndexer] Found ${logs.length} ${eventName} events`);

        for (const log of logs) {
          const parsed = this.contract.interface.parseLog({
            topics: log.topics,
            data: log.data
          });

          switch (eventName) {
            case 'DrawCreated':
              await this._indexDrawCreated(parsed.args[0], parsed.args[1], parsed.args[2]);
              break;
            case 'DrawOpened':
              await this._updateDrawStatus(parsed.args[0], 'open');
              break;
            case 'DrawClosed':
              await this._updateDrawStatus(parsed.args[0], 'closed');
              break;
            case 'DrawResolved':
              await this._indexDrawResolved(parsed.args[0], parsed.args[1], parsed.args[2]);
              break;
            case 'DrawCancelled':
              await this._indexDrawCancelled(parsed.args[0], parsed.args[1]);
              break;
            case 'BetPlaced':
              await this._indexBetPlaced(
                parsed.args[0], parsed.args[1], parsed.args[2],
                parsed.args[3], parsed.args[4], parsed.args[5]
              );
              break;
            case 'BetResolved':
              await this._indexBetResolved(parsed.args[0], parsed.args[1], parsed.args[2], parsed.args[3]);
              break;
          }
        }
      } catch (err) {
        console.error(`[BolitaIndexer] Error backfilling ${eventName}:`, err.message);
      }
    }

    console.log('[BolitaIndexer] Backfill complete');
  }
}

// Singleton
const bolitaIndexer = new BolitaIndexer();

module.exports = { bolitaIndexer, BolitaIndexer };
