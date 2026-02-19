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

    console.log('[BingoEvents] Starting event listeners...');

    // RoundCreated
    this.contract.on('RoundCreated', async (roundId, scheduledClose) => {
      try {
        await this._onRoundCreated(roundId, scheduledClose);
      } catch (err) {
        console.error('[BingoEvents] Error indexing RoundCreated:', err.message);
      }
    });

    // CardsPurchased
    this.contract.on('CardsPurchased', async (roundId, buyer, count, cardIds, totalCost) => {
      try {
        await this._onCardsPurchased(roundId, buyer, count, cardIds, totalCost);
      } catch (err) {
        console.error('[BingoEvents] Error indexing CardsPurchased:', err.message);
      }
    });

    // RoundClosed
    this.contract.on('RoundClosed', async (roundId, vrfRequestId) => {
      try {
        await this._onRoundClosed(roundId, vrfRequestId);
      } catch (err) {
        console.error('[BingoEvents] Error indexing RoundClosed:', err.message);
      }
    });

    // VrfFulfilled
    this.contract.on('VrfFulfilled', async (roundId, randomWord) => {
      try {
        await this._onVrfFulfilled(roundId, randomWord);
      } catch (err) {
        console.error('[BingoEvents] Error indexing VrfFulfilled:', err.message);
      }
    });

    // RoundResolved
    this.contract.on('RoundResolved', async (roundId, lineWinner, lineWinnerBall, bingoWinner, bingoWinnerBall, jackpotWon, jackpotPaid) => {
      try {
        await this._onRoundResolved(roundId, lineWinner, lineWinnerBall, bingoWinner, bingoWinnerBall, jackpotWon, jackpotPaid);
      } catch (err) {
        console.error('[BingoEvents] Error indexing RoundResolved:', err.message);
      }
    });

    // RoundNoWinner
    this.contract.on('RoundNoWinner', async (roundId, toJackpot) => {
      try {
        await this._onRoundNoWinner(roundId, toJackpot);
      } catch (err) {
        console.error('[BingoEvents] Error indexing RoundNoWinner:', err.message);
      }
    });

    // RoundCancelled
    this.contract.on('RoundCancelled', async (roundId, refunded) => {
      try {
        await this._onRoundCancelled(roundId, refunded);
      } catch (err) {
        console.error('[BingoEvents] Error indexing RoundCancelled:', err.message);
      }
    });

    // JackpotContribution
    this.contract.on('JackpotContribution', async (roundId, amount, newBalance) => {
      try {
        await this._updateBingoPool();
      } catch (err) {
        console.error('[BingoEvents] Error on JackpotContribution:', err.message);
      }
    });

    // JackpotPaid
    this.contract.on('JackpotPaid', async (roundId, winner, amount) => {
      try {
        await this._updateBingoPool();
      } catch (err) {
        console.error('[BingoEvents] Error on JackpotPaid:', err.message);
      }
    });

    // FeesAccrued
    this.contract.on('FeesAccrued', async (roundId, amount, totalAccrued) => {
      try {
        await this._updateBingoPool();
      } catch (err) {
        console.error('[BingoEvents] Error on FeesAccrued:', err.message);
      }
    });

    console.log('[BingoEvents] Event listeners active');
  }

  stop() {
    if (this.contract) {
      this.contract.removeAllListeners();
    }
    this.isRunning = false;
    console.log('[BingoEvents] Stopped');
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
