/**
 * Bingo Service
 *
 * Orchestrator for Bingo game operations.
 * Handles config, rounds, cards, history, admin actions.
 * Off-chain mode: createRoundOffChain, buyCardsOffChain, resolveRoundOffChain
 */

const crypto = require('crypto');
const pool = require('../db');
const gameConfigService = require('./gameConfigService');
const { drawBallsFromVrfSeed, detectWinners, checkCard, ZERO_ADDRESS } = require('./bingoResolverService');

const TOKEN_DECIMALS = 6;

/**
 * Get bingo game configuration for public display
 */
async function getConfig() {
  const config = await gameConfigService.getBingoConfig();

  // Try to get on-chain data, fall back to off-chain pool
  let jackpotBalance = 0;
  let availablePool = 0;
  try {
    const isOnChain = !!process.env.BINGO_CONTRACT_ADDRESS;
    if (isOnChain) {
      const { getBingoContractReadOnly } = require('../chain/bingoProvider');
      const { ethers } = require('ethers');
      const contract = getBingoContractReadOnly();
      const [jp, ap, cp] = await Promise.all([
        contract.jackpotBalance(),
        contract.availablePool(),
        contract.cardPrice(),
      ]);
      jackpotBalance = parseFloat(ethers.formatUnits(jp, TOKEN_DECIMALS));
      availablePool = parseFloat(ethers.formatUnits(ap, TOKEN_DECIMALS));
      config.cardPrice = parseFloat(ethers.formatUnits(cp, TOKEN_DECIMALS));
    } else {
      // Off-chain: read from bingo_pool table
      const poolResult = await pool.query('SELECT jackpot_balance, accrued_fees FROM bingo_pool WHERE id = 1');
      if (poolResult.rows.length > 0) {
        jackpotBalance = parseFloat(poolResult.rows[0].jackpot_balance || 0);
        availablePool = jackpotBalance;
      }
    }
  } catch (err) {
    console.warn('[Bingo] Could not read pool data:', err.message);
  }

  return {
    ...config,
    jackpotBalance,
    availablePool,
    columnRanges: {
      B: [1, 15],
      I: [16, 30],
      N: [31, 45],
      G: [46, 60],
      O: [61, 75],
    },
  };
}

/**
 * List rounds with optional status filter
 */
async function getRounds(status, limit = 20) {
  let query = 'SELECT * FROM bingo_rounds';
  const params = [];
  let paramIdx = 1;

  if (status) {
    query += ` WHERE status = $${paramIdx++}`;
    params.push(status);
  }

  query += ` ORDER BY round_id DESC LIMIT $${paramIdx}`;
  params.push(Math.min(parseInt(limit) || 20, 100));

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get full round detail including cards and results
 */
async function getRoundDetail(roundId) {
  const roundResult = await pool.query(
    'SELECT * FROM bingo_rounds WHERE round_id = $1',
    [roundId]
  );
  if (roundResult.rows.length === 0) return null;
  const round = roundResult.rows[0];

  const cardsResult = await pool.query(
    'SELECT * FROM bingo_cards WHERE round_id = $1 ORDER BY card_id',
    [roundId]
  );

  const resultsResult = await pool.query(
    'SELECT * FROM bingo_results WHERE round_id = $1',
    [roundId]
  );

  return {
    round,
    cards: cardsResult.rows,
    results: resultsResult.rows[0] || null,
  };
}

/**
 * Get a user's cards, optionally filtered by round
 */
async function getUserCards(walletAddress, roundId) {
  const addr = walletAddress.toLowerCase();
  let query = 'SELECT bc.*, br.status as round_status FROM bingo_cards bc JOIN bingo_rounds br ON bc.round_id = br.round_id WHERE bc.owner_address = $1';
  const params = [addr];

  if (roundId) {
    query += ' AND bc.round_id = $2';
    params.push(parseInt(roundId));
  }

  query += ' ORDER BY bc.card_id DESC';

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get user's past round history
 */
async function getUserHistory(walletAddress, limit = 20) {
  const addr = walletAddress.toLowerCase();
  const result = await pool.query(
    `SELECT DISTINCT br.*
     FROM bingo_rounds br
     JOIN bingo_cards bc ON br.round_id = bc.round_id
     WHERE bc.owner_address = $1
     ORDER BY br.round_id DESC
     LIMIT $2`,
    [addr, Math.min(parseInt(limit) || 20, 100)]
  );
  return result.rows;
}

/**
 * Get public verification data for a round
 */
async function getVerificationData(roundId) {
  const roundResult = await pool.query(
    'SELECT round_id, vrf_random_word, drawn_balls, status FROM bingo_rounds WHERE round_id = $1',
    [roundId]
  );
  if (roundResult.rows.length === 0) return null;
  const round = roundResult.rows[0];

  if (round.status !== 'resolved') {
    return { roundId: round.round_id, status: round.status, message: 'Round not yet resolved' };
  }

  const cardsResult = await pool.query(
    'SELECT card_id, owner_address, numbers, line_hit_ball, bingo_hit_ball, is_line_winner, is_bingo_winner FROM bingo_cards WHERE round_id = $1 ORDER BY card_id',
    [roundId]
  );

  const resultsResult = await pool.query(
    'SELECT vrf_seed, drawn_balls, line_winner_card_id, bingo_winner_card_id, resolution_time_ms, tx_hash FROM bingo_results WHERE round_id = $1',
    [roundId]
  );

  return {
    roundId: round.round_id,
    status: round.status,
    vrfSeed: round.vrf_random_word,
    drawnBalls: round.drawn_balls,
    cards: cardsResult.rows,
    results: resultsResult.rows[0] || null,
  };
}

/**
 * Admin: create a new round on-chain
 */
async function createRound(scheduledCloseTimestamp) {
  const { getBingoContract } = require('../chain/bingoProvider');
  const contract = getBingoContract();

  const tx = await contract.createRound(scheduledCloseTimestamp);
  const receipt = await tx.wait();

  // Parse RoundCreated event
  let roundId;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === 'RoundCreated') {
        roundId = Number(parsed.args.roundId);
        break;
      }
    } catch (_) {}
  }

  console.log(`[Bingo] Round created on-chain: #${roundId}`);
  return { roundId, txHash: receipt.hash };
}

/**
 * Admin: close a round and request VRF
 */
async function closeRound(roundId) {
  const { getBingoContract } = require('../chain/bingoProvider');
  const contract = getBingoContract();

  const tx = await contract.closeAndRequestVRF(roundId);
  const receipt = await tx.wait();

  console.log(`[Bingo] Round ${roundId} closed, VRF requested. tx: ${receipt.hash}`);
  return { roundId, txHash: receipt.hash };
}

/**
 * Admin: cancel a round
 */
async function cancelRound(roundId) {
  const { getBingoContract } = require('../chain/bingoProvider');
  const contract = getBingoContract();

  const tx = await contract.cancelRound(roundId);
  const receipt = await tx.wait();

  console.log(`[Bingo] Round ${roundId} cancelled. tx: ${receipt.hash}`);
  return { roundId, txHash: receipt.hash };
}

/**
 * Admin: get stats
 */
async function getAdminStats(dateFrom, dateTo) {
  let dateFilter = '';
  const params = [];
  let paramIdx = 1;

  if (dateFrom) {
    dateFilter += ` AND br.created_at >= $${paramIdx++}`;
    params.push(dateFrom);
  }
  if (dateTo) {
    dateFilter += ` AND br.created_at <= $${paramIdx++}`;
    params.push(dateTo);
  }

  const statsResult = await pool.query(
    `SELECT
       COUNT(*) as total_rounds,
       COUNT(*) FILTER (WHERE status = 'resolved') as resolved_rounds,
       COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_rounds,
       COALESCE(SUM(total_cards), 0) as total_cards,
       COALESCE(SUM(total_revenue), 0) as total_revenue,
       COALESCE(SUM(fee_amount), 0) as total_fees,
       COALESCE(SUM(line_prize), 0) as total_line_prizes,
       COALESCE(SUM(bingo_prize), 0) as total_bingo_prizes,
       COALESCE(SUM(jackpot_paid), 0) as total_jackpot_paid
     FROM bingo_rounds br
     WHERE 1=1 ${dateFilter}`,
    params
  );

  const poolResult = await pool.query('SELECT * FROM bingo_pool WHERE id = 1');

  return {
    ...statsResult.rows[0],
    pool: poolResult.rows[0] || {},
  };
}

// ==========================================================================
// OFF-CHAIN MODE: Round lifecycle + card generation
// ==========================================================================

/** Next round_id counter (off-chain). Reads max from DB on first call. */
let _nextRoundId = null;

async function getNextRoundId() {
  if (_nextRoundId === null) {
    const result = await pool.query('SELECT COALESCE(MAX(round_id), 0) AS max_id FROM bingo_rounds');
    _nextRoundId = result.rows[0].max_id + 1;
  }
  return _nextRoundId++;
}

/** Next card_id counter (off-chain). */
let _nextCardId = null;

async function getNextCardId() {
  if (_nextCardId === null) {
    const result = await pool.query('SELECT COALESCE(MAX(card_id), 0) AS max_id FROM bingo_cards');
    _nextCardId = result.rows[0].max_id + 1;
  }
  return _nextCardId++;
}

/**
 * Generate a bingo card: 3 rows x 5 columns.
 * Each column picks 3 unique numbers from its range:
 *   B:1-15  I:16-30  N:31-45  G:46-60  O:61-75
 * Returns flat array of 15 numbers in row-major order.
 */
function generateCardNumbers() {
  const ranges = [
    [1, 15],   // B
    [16, 30],  // I
    [31, 45],  // N
    [46, 60],  // G
    [61, 75],  // O
  ];

  // Pick 3 unique from each column
  const columns = ranges.map(([min, max]) => {
    const pool = [];
    for (let i = min; i <= max; i++) pool.push(i);
    // Fisher-Yates pick 3
    for (let i = pool.length - 1; i > pool.length - 4 && i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(pool.length - 3).sort((a, b) => a - b);
  });

  // Convert column-major to row-major: row0=[col0[0], col1[0], ...], row1=[col0[1], ...]
  const numbers = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      numbers.push(columns[col][row]);
    }
  }
  return numbers;
}

/**
 * Create a new round off-chain.
 * @param {number} buyWindowSeconds - seconds the round stays open
 * @returns {Object} { roundId, scheduledClose }
 */
async function createRoundOffChain(buyWindowSeconds = 45) {
  const roundId = await getNextRoundId();
  const now = new Date();
  const scheduledClose = new Date(now.getTime() + buyWindowSeconds * 1000);

  await pool.query(
    `INSERT INTO bingo_rounds (round_id, status, scheduled_close, created_at, updated_at)
     VALUES ($1, 'open', $2, NOW(), NOW())
     ON CONFLICT (round_id) DO NOTHING`,
    [roundId, scheduledClose]
  );

  console.log(`[Bingo] Off-chain round #${roundId} created, closes at ${scheduledClose.toISOString()}`);
  return { roundId, scheduledClose };
}

/**
 * Buy cards off-chain for a user.
 * @param {string} walletAddress
 * @param {number} roundId
 * @param {number} count - 1 to 4
 * @returns {Array} cards bought
 */
async function buyCardsOffChain(walletAddress, roundId, count = 1) {
  const addr = walletAddress.toLowerCase();
  const config = await gameConfigService.getBingoConfig();
  const maxCards = config.maxCardsPerUser || 4;
  const cardPrice = config.cardPrice || 1;

  // Validate round is open
  const roundResult = await pool.query(
    'SELECT * FROM bingo_rounds WHERE round_id = $1',
    [roundId]
  );
  if (roundResult.rows.length === 0) throw new Error('Round not found');
  const round = roundResult.rows[0];
  if (round.status !== 'open') throw new Error('Round is not open for purchases');

  // Check time hasn't expired
  if (round.scheduled_close && new Date() >= new Date(round.scheduled_close)) {
    throw new Error('Round buy window has closed');
  }

  // Check user hasn't exceeded max cards
  const existingCards = await pool.query(
    'SELECT COUNT(*) AS cnt FROM bingo_cards WHERE round_id = $1 AND owner_address = $2',
    [roundId, addr]
  );
  const existingCount = parseInt(existingCards.rows[0].cnt);
  if (existingCount + count > maxCards) {
    throw new Error(`Max ${maxCards} cards per round. You already have ${existingCount}.`);
  }

  const totalCost = cardPrice * count;

  // Deduct balance from user
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deduct balance
    const balResult = await client.query(
      'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE wallet_address = $2 AND balance >= $1 RETURNING id, balance',
      [totalCost, addr]
    );
    if (balResult.rows.length === 0) {
      throw new Error('Insufficient balance');
    }

    const cards = [];
    for (let i = 0; i < count; i++) {
      const cardId = await getNextCardId();
      const numbers = generateCardNumbers();
      const cardIndex = existingCount + i;

      await client.query(
        `INSERT INTO bingo_cards (card_id, round_id, owner_address, card_index, numbers, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [cardId, roundId, addr, cardIndex, JSON.stringify(numbers)]
      );

      cards.push({ cardId, roundId, ownerAddress: addr, cardIndex, numbers });
    }

    // Update round totals
    await client.query(
      `UPDATE bingo_rounds SET total_cards = total_cards + $1, total_revenue = total_revenue + $2, updated_at = NOW() WHERE round_id = $3`,
      [count, totalCost, roundId]
    );

    await client.query('COMMIT');
    console.log(`[Bingo] ${addr} bought ${count} card(s) for round #${roundId}`);
    return cards;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Close a round off-chain (no more purchases).
 */
async function closeRoundOffChain(roundId) {
  await pool.query(
    `UPDATE bingo_rounds SET status = 'closed', updated_at = NOW() WHERE round_id = $1 AND status = 'open'`,
    [roundId]
  );
  console.log(`[Bingo] Off-chain round #${roundId} closed`);
}

/**
 * Resolve a round off-chain: generate VRF seed, draw balls, detect winners, calculate prizes.
 */
async function resolveRoundOffChain(roundId) {
  const startTime = Date.now();

  // 1. Fetch round
  const roundResult = await pool.query('SELECT * FROM bingo_rounds WHERE round_id = $1', [roundId]);
  if (roundResult.rows.length === 0) throw new Error(`Round ${roundId} not found`);
  const round = roundResult.rows[0];
  if (round.status !== 'closed') throw new Error(`Round ${roundId} is not closed (status: ${round.status})`);

  // 2. Fetch cards
  const cardsResult = await pool.query(
    'SELECT card_id, owner_address, numbers FROM bingo_cards WHERE round_id = $1 ORDER BY card_id',
    [roundId]
  );

  if (cardsResult.rows.length === 0) {
    // No cards sold — cancel the round
    await pool.query(
      `UPDATE bingo_rounds SET status = 'cancelled', updated_at = NOW() WHERE round_id = $1`,
      [roundId]
    );
    console.log(`[Bingo] Round #${roundId} cancelled (no cards sold)`);
    return { roundId, cancelled: true, reason: 'no cards' };
  }

  const cards = cardsResult.rows.map(row => ({
    cardId: row.card_id,
    owner: row.owner_address,
    numbers: row.numbers,
  }));

  // 3. Generate VRF seed from crypto.randomBytes
  const vrfSeed = '0x' + crypto.randomBytes(32).toString('hex');
  const vrfBigInt = BigInt(vrfSeed);

  // 4. Draw balls using existing resolver
  const drawnBalls = drawBallsFromVrfSeed(vrfBigInt.toString());

  // 5. Detect winners
  const winners = detectWinners(cards, drawnBalls);

  // 6. Calculate prizes
  const config = await gameConfigService.getBingoConfig();
  const revenue = parseFloat(round.total_revenue) || 0;
  const feeBps = config.feeBps || 1000;
  const reserveBps = config.reserveBps || 1000;
  const linePrizeBps = config.linePrizeBps || 1000;
  const bingoPrizeBps = config.bingoPrizeBps || 7000;
  const jackpotThreshold = config.jackpotBallThreshold || 25;

  const feeAmount = (revenue * feeBps) / 10000;
  const reserveAmount = (revenue * reserveBps) / 10000;
  const winnerPot = revenue - feeAmount - reserveAmount;

  let linePrize = 0;
  let bingoPrize = 0;
  let jackpotWon = false;
  let jackpotPaid = 0;

  const hasLineWinner = winners.lineWinner !== ZERO_ADDRESS;
  const hasBingoWinner = winners.bingoWinner !== ZERO_ADDRESS;

  if (hasLineWinner || hasBingoWinner) {
    if (hasLineWinner) {
      linePrize = (winnerPot * linePrizeBps) / 10000;
    }
    if (hasBingoWinner) {
      bingoPrize = (winnerPot * bingoPrizeBps) / 10000;

      // Jackpot check: bingo at ball <= threshold
      if (winners.bingoWinnerBall <= jackpotThreshold) {
        const poolResult = await pool.query('SELECT jackpot_balance FROM bingo_pool WHERE id = 1');
        const currentJackpot = parseFloat(poolResult.rows[0]?.jackpot_balance || 0);
        if (currentJackpot > 0) {
          jackpotWon = true;
          jackpotPaid = currentJackpot;
        }
      }
    }
    // Remaining of winnerPot that isn't line/bingo prize goes to reserve
  } else {
    // No winners: 10% fee, rest to jackpot
    // fee already calculated; everything else goes to reserve/jackpot
  }

  // 7. Store results in DB
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update round
    await client.query(
      `UPDATE bingo_rounds SET
         status = 'resolved',
         vrf_random_word = $1,
         drawn_balls = $2,
         line_winner = $3,
         bingo_winner = $4,
         fee_amount = $5,
         reserve_amount = $6,
         line_prize = $7,
         bingo_prize = $8,
         jackpot_won = $9,
         jackpot_paid = $10,
         updated_at = NOW()
       WHERE round_id = $11`,
      [
        vrfSeed,
        JSON.stringify(drawnBalls),
        hasLineWinner ? winners.lineWinner : null,
        hasBingoWinner ? winners.bingoWinner : null,
        feeAmount,
        reserveAmount,
        linePrize,
        bingoPrize,
        jackpotWon,
        jackpotPaid,
        roundId,
      ]
    );

    // Insert bingo_results
    await client.query(
      `INSERT INTO bingo_results (round_id, vrf_seed, drawn_balls, line_winner_card_id, bingo_winner_card_id, resolution_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (round_id) DO UPDATE SET
         drawn_balls = EXCLUDED.drawn_balls,
         line_winner_card_id = EXCLUDED.line_winner_card_id,
         bingo_winner_card_id = EXCLUDED.bingo_winner_card_id,
         resolution_time_ms = EXCLUDED.resolution_time_ms`,
      [roundId, vrfSeed, JSON.stringify(drawnBalls), winners.lineWinnerCardId, winners.bingoWinnerCardId, Date.now() - startTime]
    );

    // Update individual cards with hit info
    for (const card of cards) {
      const result = checkCard(card.numbers, drawnBalls);
      const isLineWinner = winners.lineWinnerCardId === card.cardId;
      const isBingoWinner = winners.bingoWinnerCardId === card.cardId;

      await client.query(
        `UPDATE bingo_cards SET line_hit_ball = $1, bingo_hit_ball = $2, is_line_winner = $3, is_bingo_winner = $4 WHERE card_id = $5`,
        [result.lineHitBall, result.bingoHitBall, isLineWinner, isBingoWinner, card.cardId]
      );
    }

    // Update bingo_pool: add fees, add reserve to jackpot
    await client.query(
      `UPDATE bingo_pool SET
         accrued_fees = accrued_fees + $1,
         jackpot_balance = jackpot_balance + $2 - $3,
         total_rounds = total_rounds + 1,
         total_cards_sold = total_cards_sold + $4,
         total_revenue = total_revenue + $5,
         total_payouts = total_payouts + $6,
         updated_at = NOW()
       WHERE id = 1`,
      [
        feeAmount,
        reserveAmount,
        jackpotPaid,
        cards.length,
        revenue,
        linePrize + bingoPrize + jackpotPaid,
      ]
    );

    // Pay winners: credit balances
    if (hasLineWinner && linePrize > 0) {
      await client.query(
        'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE wallet_address = $2',
        [linePrize, winners.lineWinner]
      );
    }
    if (hasBingoWinner && bingoPrize > 0) {
      let totalBingoPrize = bingoPrize + jackpotPaid;
      await client.query(
        'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE wallet_address = $2',
        [totalBingoPrize, winners.bingoWinner]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const resolutionTimeMs = Date.now() - startTime;
  console.log(`[Bingo] Off-chain round #${roundId} resolved in ${resolutionTimeMs}ms — line: ${hasLineWinner ? winners.lineWinner : 'none'}, bingo: ${hasBingoWinner ? winners.bingoWinner : 'none'}`);

  return {
    roundId,
    drawnBalls,
    lineWinner: winners.lineWinner,
    lineWinnerBall: winners.lineWinnerBall,
    bingoWinner: winners.bingoWinner,
    bingoWinnerBall: winners.bingoWinnerBall,
    linePrize,
    bingoPrize,
    jackpotWon,
    jackpotPaid,
    feeAmount,
    reserveAmount,
    resolutionTimeMs,
  };
}

/**
 * Get jackpot balance from bingo_pool (off-chain).
 */
async function getJackpotBalance() {
  const result = await pool.query('SELECT jackpot_balance FROM bingo_pool WHERE id = 1');
  return parseFloat(result.rows[0]?.jackpot_balance || 0);
}

module.exports = {
  getConfig,
  getRounds,
  getRoundDetail,
  getUserCards,
  getUserHistory,
  getVerificationData,
  createRound,
  closeRound,
  cancelRound,
  getAdminStats,
  // Off-chain
  createRoundOffChain,
  buyCardsOffChain,
  closeRoundOffChain,
  resolveRoundOffChain,
  generateCardNumbers,
  getJackpotBalance,
};
