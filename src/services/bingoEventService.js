/**
 * Bingo Event Service
 *
 * Listens to BingoGame.sol contract events and indexes them in PostgreSQL.
 * Auto-resolves rounds when VRF is fulfilled (if enabled).
 *
 * Events:
 *   RoundCreated, CardsPurchased, RoundClosed, VrfFulfilled,
 *   RoundResolved, RoundNoWinner, RoundCancelled,
 *   JackpotContribution, JackpotPaid, FeesAccrued
 */

const { ethers } = require('ethers');
const pool = require('../db');
const BingoGameABI = require('../chain/abi/BingoGame.abi.json');

const TOKEN_DECIMALS = 6;

class BingoEventService {
  constructor() {
    this.contract = null;
    this.provider = null;
    this.isRunning = false;
    this.pollTimer = null;
    this.lastBlockProcessed = 0;
    this.pollingInterval = 12000; // 12s
  }

  async init() {
    const contractAddress = process.env.BINGO_CONTRACT_ADDRESS;
    const rpcUrl = process.env.POLYGON_RPC_URL || process.env.RPC_URL;

    if (!contractAddress || !rpcUrl) {
      console.log('[BingoEvents] Missing BINGO_CONTRACT_ADDRESS or RPC_URL, skipping');
      return false;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.contract = new ethers.Contract(contractAddress, BingoGameABI, this.provider);
      console.log(`[BingoEvents] Initialized for contract ${contractAddress}`);
      return true;
    } catch (error) {
      console.error('[BingoEvents] Failed to initialize:', error.message);
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

    console.log('[BingoEvents] Starting event listeners (getLogs polling)...');

    // Seed lastBlockProcessed from current chain tip
    try {
      this.lastBlockProcessed = await this.provider.getBlockNumber();
    } catch (_) {
      this.lastBlockProcessed = 0;
    }

    this._schedulePoll();

    console.log('[BingoEvents] Event listeners active');
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    console.log('[BingoEvents] Stopped');
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
          address: process.env.BINGO_CONTRACT_ADDRESS,
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
      console.error('[BingoEvents] Poll error:', err.message);
    }
    this._schedulePoll();
  }

  async _dispatch(parsed) {
    const { name, args } = parsed;
    try {
      if (name === 'RoundCreated')        await this._onRoundCreated(args[0], args[1]);
      else if (name === 'CardsPurchased') await this._onCardsPurchased(args[0], args[1], args[2], args[3], args[4]);
      else if (name === 'RoundClosed')    await this._onRoundClosed(args[0], args[1]);
      else if (name === 'VrfFulfilled')   await this._onVrfFulfilled(args[0], args[1]);
      else if (name === 'RoundResolved')  await this._onRoundResolved(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
      else if (name === 'RoundNoWinner')  await this._onRoundNoWinner(args[0], args[1]);
      else if (name === 'RoundCancelled') await this._onRoundCancelled(args[0], args[1]);
      else if (name === 'JackpotContribution' || name === 'JackpotPaid' || name === 'FeesAccrued')
        await this._updateBingoPool();
    } catch (err) {
      console.error(`[BingoEvents] Error handling ${name}:`, err.message);
    }
  }

  // ── Event Handlers ──

  async _onRoundCreated(roundId, scheduledClose) {
    const id = Number(roundId);
    const closeTime = new Date(Number(scheduledClose) * 1000);

    await pool.query(
      `INSERT INTO bingo_rounds (round_id, status, scheduled_close, created_at, updated_at)
       VALUES ($1, 'open', $2, NOW(), NOW())
       ON CONFLICT (round_id) DO UPDATE SET
         status = 'open',
         scheduled_close = $2,
         updated_at = NOW()`,
      [id, closeTime]
    );

    console.log(`[BingoEvents] RoundCreated #${id}, closes at ${closeTime.toISOString()}`);
  }

  async _onCardsPurchased(roundId, buyer, count, cardIds, totalCost) {
    const rId = Number(roundId);
    const buyerAddr = buyer.toLowerCase();
    const numCards = Number(count);
    const cost = parseFloat(ethers.formatUnits(totalCost, TOKEN_DECIMALS));

    // Fetch card numbers from contract for each card
    const { getBingoContractReadOnly } = require('../chain/bingoProvider');
    const contract = getBingoContractReadOnly();

    for (let i = 0; i < cardIds.length; i++) {
      const cardId = Number(cardIds[i]);
      try {
        const nums = await contract.getCardNumbers(cardId);
        const numbersArray = Array.from(nums).map(Number);

        await pool.query(
          `INSERT INTO bingo_cards (card_id, round_id, owner_address, card_index, numbers, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (card_id) DO NOTHING`,
          [cardId, rId, buyerAddr, i, JSON.stringify(numbersArray)]
        );
      } catch (err) {
        console.error(`[BingoEvents] Error fetching card ${cardId} numbers:`, err.message);
      }
    }

    // Update round totals
    await pool.query(
      `UPDATE bingo_rounds SET
         total_cards = total_cards + $1,
         total_revenue = total_revenue + $2,
         updated_at = NOW()
       WHERE round_id = $3`,
      [numCards, cost, rId]
    );

    console.log(`[BingoEvents] CardsPurchased: round=${rId} buyer=${buyerAddr} count=${numCards} cost=${cost}`);
  }

  async _onRoundClosed(roundId, vrfRequestId) {
    const id = Number(roundId);
    await pool.query(
      `UPDATE bingo_rounds SET status = 'vrf_requested', updated_at = NOW()
       WHERE round_id = $1`,
      [id]
    );
    console.log(`[BingoEvents] RoundClosed #${id}, VRF requested`);
  }

  async _onVrfFulfilled(roundId, randomWord) {
    const id = Number(roundId);
    const vrfWord = randomWord.toString();

    await pool.query(
      `UPDATE bingo_rounds SET
         status = 'vrf_fulfilled',
         vrf_random_word = $1,
         updated_at = NOW()
       WHERE round_id = $2`,
      [vrfWord, id]
    );
    console.log(`[BingoEvents] VrfFulfilled #${id}`);

    // Auto-resolve if enabled
    try {
      const gameConfigService = require('./gameConfigService');
      const autoResolve = await gameConfigService.getConfigValue('bingo_auto_resolve_enabled', true);
      if (autoResolve) {
        console.log(`[BingoEvents] Auto-resolving round ${id}...`);
        const bingoResolverService = require('./bingoResolverService');
        await bingoResolverService.resolveRound(id);
      }
    } catch (err) {
      console.error(`[BingoEvents] Auto-resolve failed for round ${id}:`, err.message);
    }
  }

  async _onRoundResolved(roundId, lineWinner, lineWinnerBall, bingoWinner, bingoWinnerBall, jackpotWon, jackpotPaid) {
    const id = Number(roundId);
    const jpPaid = ethers.formatUnits(jackpotPaid, TOKEN_DECIMALS);

    // Sync full financial data from contract
    await this._syncRoundFromContract(id);

    console.log(`[BingoEvents] RoundResolved #${id}: line=${lineWinner} bingo=${bingoWinner} jackpotWon=${jackpotWon}`);
  }

  async _onRoundNoWinner(roundId, toJackpot) {
    const id = Number(roundId);
    const jpAmount = ethers.formatUnits(toJackpot, TOKEN_DECIMALS);

    await pool.query(
      `UPDATE bingo_rounds SET status = 'resolved', updated_at = NOW()
       WHERE round_id = $1`,
      [id]
    );

    await this._updateBingoPool();
    console.log(`[BingoEvents] RoundNoWinner #${id}: ${jpAmount} USDT to jackpot`);
  }

  async _onRoundCancelled(roundId, refunded) {
    const id = Number(roundId);
    await pool.query(
      `UPDATE bingo_rounds SET status = 'cancelled', updated_at = NOW()
       WHERE round_id = $1`,
      [id]
    );
    console.log(`[BingoEvents] RoundCancelled #${id}`);
  }

  // ── Sync Helpers ──

  async _syncRoundFromContract(roundId) {
    try {
      const { getBingoContractReadOnly } = require('../chain/bingoProvider');
      const contract = getBingoContractReadOnly();

      // getRoundResults returns: (address[] lineWinners, uint8 lineWinnerBall,
      //   address[] bingoWinners, uint8 bingoWinnerBall, bool jackpotWon,
      //   uint256 jackpotPaid, uint256 feeAmount, uint256 reserveAmount,
      //   uint256 linePrize, uint256 bingoPrize)
      const [lineWinners, lineWinnerBall, bingoWinners, bingoWinnerBall,
             jackpotWon, jackpotPaid, feeAmount, reserveAmount, linePrize, bingoPrize] =
        await contract.getRoundResults(roundId);

      // Store first winner address for backward-compat single-address column
      const lineWinnerAddr  = lineWinners.length > 0  ? lineWinners[0].toLowerCase()  : null;
      const bingoWinnerAddr = bingoWinners.length > 0 ? bingoWinners[0].toLowerCase() : null;

      await pool.query(
        `UPDATE bingo_rounds SET
           status = 'resolved',
           line_winner = $1,
           bingo_winner = $2,
           fee_amount = $3,
           reserve_amount = $4,
           line_prize = $5,
           bingo_prize = $6,
           jackpot_won = $7,
           jackpot_paid = $8,
           line_winner_ball = $9,
           bingo_winner_ball = $10,
           updated_at = NOW()
         WHERE round_id = $11 AND status NOT IN ('cancelled', 'open', 'closed')`,
        [
          lineWinnerAddr,
          bingoWinnerAddr,
          ethers.formatUnits(feeAmount, TOKEN_DECIMALS),
          ethers.formatUnits(reserveAmount, TOKEN_DECIMALS),
          ethers.formatUnits(linePrize, TOKEN_DECIMALS),
          ethers.formatUnits(bingoPrize, TOKEN_DECIMALS),
          jackpotWon,
          ethers.formatUnits(jackpotPaid, TOKEN_DECIMALS),
          Number(lineWinnerBall),
          Number(bingoWinnerBall),
          roundId,
        ]
      );
    } catch (err) {
      console.error(`[BingoEvents] Error syncing round ${roundId}:`, err.message);
    }
  }

  async _updateBingoPool() {
    try {
      const { getBingoContractReadOnly } = require('../chain/bingoProvider');
      const contract = getBingoContractReadOnly();

      const [jackpot, fees, roundCount, cardCount] = await Promise.all([
        contract.jackpotBalance(),
        contract.accruedFees(),
        contract.roundCounter(),
        contract.cardCounter(),
      ]);

      await pool.query(
        `UPDATE bingo_pool SET
           jackpot_balance = $1,
           accrued_fees = $2,
           total_rounds = $3,
           total_cards_sold = $4,
           updated_at = NOW()
         WHERE id = 1`,
        [
          parseFloat(ethers.formatUnits(jackpot, TOKEN_DECIMALS)),
          parseFloat(ethers.formatUnits(fees, TOKEN_DECIMALS)),
          Number(roundCount),
          Number(cardCount),
        ]
      );
    } catch (err) {
      console.error('[BingoEvents] Error updating bingo pool:', err.message);
    }
  }
}

// Singleton
const bingoEventService = new BingoEventService();

module.exports = { bingoEventService, BingoEventService };
