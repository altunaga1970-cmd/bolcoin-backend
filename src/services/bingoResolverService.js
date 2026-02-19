/**
 * Bingo Resolver Service
 *
 * Core deterministic algorithms for resolving bingo rounds.
 * Given a VRF seed and card data, produces verifiable results.
 *
 * Line rule: Row completa de 5 numeros = linea (no columnas ni diagonales)
 * Rows: [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14]
 *
 * Ball draw: Fisher-Yates shuffle seeded by keccak256(vrfSeed, index)
 * Winner detection: ball-by-ball simulation, ties broken by lowest cardId
 */

const { ethers } = require('ethers');
const pool = require('../db');

// Constants matching BingoGame.sol
const CARD_ROWS = 3;
const CARD_COLS = 5;
const NUMBERS_PER_CARD = 15;
const TOTAL_BALLS = 75;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Row definitions (indices into 15-element card array, row-major)
const ROWS = [
  [0, 1, 2, 3, 4],   // row 0
  [5, 6, 7, 8, 9],   // row 1
  [10, 11, 12, 13, 14] // row 2
];

/**
 * Draw 75 balls from a VRF seed using Fisher-Yates shuffle.
 * Deterministic: same seed always produces same ball order.
 *
 * @param {string} vrfRandomWord - uint256 as hex or decimal string
 * @returns {number[]} Array of 75 balls (1-75) in draw order
 */
function drawBallsFromVrfSeed(vrfRandomWord) {
  const seed = BigInt(vrfRandomWord);

  // Initialize pool [1, 2, ..., 75]
  const balls = [];
  for (let i = 1; i <= TOTAL_BALLS; i++) {
    balls.push(i);
  }

  // Fisher-Yates shuffle
  for (let i = 0; i < TOTAL_BALLS - 1; i++) {
    // Generate deterministic random index using keccak256(seed, i)
    const hash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256'],
        [seed, BigInt(i)]
      )
    );
    const rng = BigInt(hash);
    const remaining = TOTAL_BALLS - i;
    const j = i + Number(rng % BigInt(remaining));

    // Swap balls[i] and balls[j]
    const temp = balls[i];
    balls[i] = balls[j];
    balls[j] = temp;
  }

  return balls;
}

/**
 * Check a single card against drawn balls for line and bingo completion.
 *
 * @param {number[]} cardNumbers - 15-element array of card numbers
 * @param {number[]} drawnBalls - 75-element array of balls in draw order
 * @returns {{ lineHitBall: number|null, bingoHitBall: number|null }}
 */
function checkCard(cardNumbers, drawnBalls) {
  const marked = new Set();
  let lineHitBall = null;
  let bingoHitBall = null;

  const cardSet = new Set(cardNumbers);

  for (let ballIndex = 0; ballIndex < drawnBalls.length; ballIndex++) {
    const ball = drawnBalls[ballIndex];
    const ballNumber = ballIndex + 1; // 1-indexed ball position

    if (cardSet.has(ball)) {
      marked.add(ball);
    }

    // Check for line (first row completion)
    if (lineHitBall === null) {
      for (const row of ROWS) {
        const rowComplete = row.every(idx => marked.has(cardNumbers[idx]));
        if (rowComplete) {
          lineHitBall = ballNumber;
          break;
        }
      }
    }

    // Check for bingo (all 15 numbers)
    if (bingoHitBall === null && marked.size === NUMBERS_PER_CARD) {
      bingoHitBall = ballNumber;
      break; // No need to continue after full bingo
    }
  }

  return { lineHitBall, bingoHitBall };
}

/**
 * Detect winners across all cards by simulating ball-by-ball draws.
 * First card(s) to complete a row = line winner(s).
 * First card(s) to complete all 15 = bingo winner(s).
 * If multiple cards hit the same milestone at the same ball number, ALL are co-winners
 * and the prize is split equally among them.
 *
 * @param {Array<{cardId: number, owner: string, numbers: number[]}>} cards
 * @param {number[]} drawnBalls - 75-element array
 * @returns {{ lineWinners, lineWinnerBall, bingoWinners, bingoWinnerBall }}
 */
function detectWinners(cards, drawnBalls) {
  // Pre-compute card results
  const results = [];
  for (const card of cards) {
    const result = checkCard(card.numbers, drawnBalls);
    results.push({ ...result, cardId: card.cardId, owner: card.owner });
  }

  // Find earliest line ball number
  let lineWinnerBall = 0;
  for (const r of results) {
    if (r.lineHitBall === null) continue;
    if (lineWinnerBall === 0 || r.lineHitBall < lineWinnerBall) {
      lineWinnerBall = r.lineHitBall;
    }
  }

  // Collect ALL cards that hit line at that earliest ball, sorted by cardId (tie-breaking)
  const lineWinners = lineWinnerBall > 0
    ? results
        .filter(r => r.lineHitBall === lineWinnerBall)
        .map(r => ({ owner: r.owner, cardId: r.cardId }))
        .sort((a, b) => a.cardId - b.cardId)
    : [];

  // Find earliest bingo ball number
  let bingoWinnerBall = 0;
  for (const r of results) {
    if (r.bingoHitBall === null) continue;
    if (bingoWinnerBall === 0 || r.bingoHitBall < bingoWinnerBall) {
      bingoWinnerBall = r.bingoHitBall;
    }
  }

  // Collect ALL cards that hit bingo at that earliest ball, sorted by cardId (tie-breaking)
  const bingoWinners = bingoWinnerBall > 0
    ? results
        .filter(r => r.bingoHitBall === bingoWinnerBall)
        .map(r => ({ owner: r.owner, cardId: r.cardId }))
        .sort((a, b) => a.cardId - b.cardId)
    : [];

  return {
    lineWinners,
    lineWinnerBall,
    bingoWinners,
    bingoWinnerBall,
    // Legacy compat: first winner (for backward-compatible fields)
    lineWinner: lineWinners.length > 0 ? lineWinners[0].owner : ZERO_ADDRESS,
    lineWinnerCardId: lineWinners.length > 0 ? lineWinners[0].cardId : null,
    bingoWinner: bingoWinners.length > 0 ? bingoWinners[0].owner : ZERO_ADDRESS,
    bingoWinnerCardId: bingoWinners.length > 0 ? bingoWinners[0].cardId : null,
  };
}

/**
 * Sign EIP-712 ResolveRound message.
 *
 * Contract typehash:
 *   ResolveRound(uint256 roundId,address[] lineWinners,uint8 lineWinnerBall,
 *                address[] bingoWinners,uint8 bingoWinnerBall)
 *
 * @param {number}   roundId
 * @param {string[]} lineWinners    - array of winner addresses (empty if no line)
 * @param {number}   lineWinnerBall - 0 if no line winner
 * @param {string[]} bingoWinners   - array of winner addresses (empty if no bingo)
 * @param {number}   bingoWinnerBall - 0 if no bingo winner
 * @returns {Promise<string>} EIP-712 signature
 */
async function signResolution(roundId, lineWinners, lineWinnerBall, bingoWinners, bingoWinnerBall) {
  const { getSigner } = require('../chain/provider');
  const { BINGO_CONTRACT_ADDRESS } = require('../chain/bingoProvider');

  const signer = getSigner();
  const chainId = (await signer.provider.getNetwork()).chainId;

  const domain = {
    name: 'BingoGame',
    version: '1',
    chainId: Number(chainId),
    verifyingContract: BINGO_CONTRACT_ADDRESS,
  };

  const types = {
    ResolveRound: [
      { name: 'roundId',         type: 'uint256'   },
      { name: 'lineWinners',     type: 'address[]' },
      { name: 'lineWinnerBall',  type: 'uint8'     },
      { name: 'bingoWinners',    type: 'address[]' },
      { name: 'bingoWinnerBall', type: 'uint8'     },
    ],
  };

  const value = {
    roundId,
    lineWinners,
    lineWinnerBall,
    bingoWinners,
    bingoWinnerBall,
  };

  const signature = await signer.signTypedData(domain, types, value);
  return signature;
}

/**
 * Full resolution pipeline for a round.
 *
 * 1. Fetch round (must be vrf_fulfilled) + all cards from DB
 * 2. Draw 75 balls from VRF seed
 * 3. detectWinners()
 * 4. Sign EIP-712
 * 5. Call contract.resolveRound()
 * 6. Store result in DB
 *
 * @param {number} roundId
 * @returns {Object} Resolution result
 */
async function resolveRound(roundId) {
  const startTime = Date.now();
  console.log(`[BingoResolver] Starting resolution for round ${roundId}`);

  // 1. Atomically claim the round: transition vrf_fulfilled → resolving.
  //    If another instance already claimed it, this UPDATE returns 0 rows.
  const claimResult = await pool.query(
    `UPDATE bingo_rounds SET status = 'resolving', updated_at = NOW()
     WHERE round_id = $1 AND status = 'vrf_fulfilled'
     RETURNING *`,
    [roundId]
  );
  if (claimResult.rowCount === 0) {
    // Either already resolved/resolving by another instance, or wrong state
    const { rows } = await pool.query('SELECT status FROM bingo_rounds WHERE round_id = $1', [roundId]);
    const current = rows[0]?.status ?? 'not found';
    console.log(`[BingoResolver] Round ${roundId} skipped — already claimed or wrong status (current: ${current})`);
    return null;
  }
  const round = claimResult.rows[0];
  if (!round.vrf_random_word) {
    // Roll back the status claim before throwing
    await pool.query(
      `UPDATE bingo_rounds SET status = 'vrf_fulfilled', updated_at = NOW() WHERE round_id = $1`,
      [roundId]
    );
    throw new Error(`Round ${roundId} has no VRF random word`);
  }

  // 2. Fetch all cards for this round
  const cardsResult = await pool.query(
    'SELECT card_id, owner_address, numbers FROM bingo_cards WHERE round_id = $1 ORDER BY card_id',
    [roundId]
  );
  if (cardsResult.rows.length === 0) {
    throw new Error(`Round ${roundId} has no cards`);
  }

  const cards = cardsResult.rows.map(row => ({
    cardId: row.card_id,
    owner: row.owner_address,
    numbers: row.numbers, // JSONB already parsed
  }));

  // 3. Draw balls
  const drawnBalls = drawBallsFromVrfSeed(round.vrf_random_word);
  console.log(`[BingoResolver] Drew 75 balls for round ${roundId}`);

  // 4. Detect winners
  const winners = detectWinners(cards, drawnBalls);
  console.log(`[BingoResolver] Round ${roundId} winners:`, {
    line: winners.lineWinner !== ZERO_ADDRESS ? `${winners.lineWinner} at ball ${winners.lineWinnerBall}` : 'none',
    bingo: winners.bingoWinner !== ZERO_ADDRESS ? `${winners.bingoWinner} at ball ${winners.bingoWinnerBall}` : 'none',
  });

  // Extract winner address arrays (co-winner support)
  const lineWinnerAddresses  = winners.lineWinners.map(w => w.owner);
  const bingoWinnerAddresses = winners.bingoWinners.map(w => w.owner);

  // 5. Sign EIP-712
  const signature = await signResolution(
    roundId,
    lineWinnerAddresses,
    winners.lineWinnerBall,
    bingoWinnerAddresses,
    winners.bingoWinnerBall,
  );
  console.log(`[BingoResolver] Signed resolution for round ${roundId}`);

  // 6. Call contract — if this fails, roll back resolving → vrf_fulfilled so it can retry
  let receipt;
  try {
    const { getBingoContract } = require('../chain/bingoProvider');
    const bingoContract = getBingoContract();

    const tx = await bingoContract.resolveRound(
      roundId,
      lineWinnerAddresses,
      winners.lineWinnerBall,
      bingoWinnerAddresses,
      winners.bingoWinnerBall,
      signature
    );
    receipt = await tx.wait();
    console.log(`[BingoResolver] resolveRound tx: ${receipt.hash}`);
  } catch (contractErr) {
    // Roll back the 'resolving' status so the round can be retried
    await pool.query(
      `UPDATE bingo_rounds SET status = 'vrf_fulfilled', updated_at = NOW() WHERE round_id = $1 AND status = 'resolving'`,
      [roundId]
    );
    throw contractErr;
  }

  const resolutionTimeMs = Date.now() - startTime;

  // 7. Store results in DB
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert bingo_results
    await client.query(
      `INSERT INTO bingo_results (round_id, vrf_seed, drawn_balls, line_winner_card_id, bingo_winner_card_id, resolution_time_ms, operator_signature, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (round_id) DO UPDATE SET
         drawn_balls = EXCLUDED.drawn_balls,
         line_winner_card_id = EXCLUDED.line_winner_card_id,
         bingo_winner_card_id = EXCLUDED.bingo_winner_card_id,
         resolution_time_ms = EXCLUDED.resolution_time_ms,
         operator_signature = EXCLUDED.operator_signature,
         tx_hash = EXCLUDED.tx_hash`,
      [
        roundId,
        round.vrf_random_word,
        JSON.stringify(drawnBalls),
        winners.lineWinnerCardId,
        winners.bingoWinnerCardId,
        resolutionTimeMs,
        signature,
        receipt.hash,
      ]
    );

    // Update bingo_rounds — only advance from 'resolving', never overwrite a terminal status (F-09)
    await client.query(
      `UPDATE bingo_rounds SET
         status = 'drawing',
         draw_started_at = NOW(),
         drawn_balls = $1,
         line_winner = $2,
         bingo_winner = $3,
         resolution_tx = $4,
         updated_at = NOW()
       WHERE round_id = $5 AND status = 'resolving'`,
      [
        JSON.stringify(drawnBalls),
        winners.lineWinner !== ZERO_ADDRESS ? winners.lineWinner : null,
        winners.bingoWinner !== ZERO_ADDRESS ? winners.bingoWinner : null,
        receipt.hash,
        roundId,
      ]
    );

    // Update individual cards with hit info — mark ALL co-winners (F-04)
    for (const card of cards) {
      const result = checkCard(card.numbers, drawnBalls);
      const isLineWinner  = winners.lineWinners.some(w => w.cardId === card.cardId);
      const isBingoWinner = winners.bingoWinners.some(w => w.cardId === card.cardId);

      await client.query(
        `UPDATE bingo_cards SET
           line_hit_ball = $1,
           bingo_hit_ball = $2,
           is_line_winner = $3,
           is_bingo_winner = $4
         WHERE card_id = $5`,
        [result.lineHitBall, result.bingoHitBall, isLineWinner, isBingoWinner, card.cardId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`[BingoResolver] Round ${roundId} resolved in ${resolutionTimeMs}ms`);

  return {
    roundId,
    drawnBalls,
    lineWinner: winners.lineWinner,
    lineWinnerBall: winners.lineWinnerBall,
    bingoWinner: winners.bingoWinner,
    bingoWinnerBall: winners.bingoWinnerBall,
    txHash: receipt.hash,
    resolutionTimeMs,
  };
}

module.exports = {
  // Constants (exported for tests)
  CARD_ROWS,
  CARD_COLS,
  NUMBERS_PER_CARD,
  TOTAL_BALLS,
  ZERO_ADDRESS,
  ROWS,
  // Pure functions
  drawBallsFromVrfSeed,
  checkCard,
  detectWinners,
  // EIP-712
  signResolution,
  // Full pipeline
  resolveRound,
};
