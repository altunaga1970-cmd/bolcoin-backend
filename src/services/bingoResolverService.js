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
 * First card to complete a row = line winner.
 * First card to complete all 15 = bingo winner.
 * Ties: lowest cardId wins.
 *
 * @param {Array<{cardId: number, owner: string, numbers: number[]}>} cards
 * @param {number[]} drawnBalls - 75-element array
 * @returns {{ lineWinner, lineWinnerBall, lineWinnerCardId, bingoWinner, bingoWinnerBall, bingoWinnerCardId }}
 */
function detectWinners(cards, drawnBalls) {
  let lineWinner = ZERO_ADDRESS;
  let lineWinnerBall = 0;
  let lineWinnerCardId = null;
  let bingoWinner = ZERO_ADDRESS;
  let bingoWinnerBall = 0;
  let bingoWinnerCardId = null;

  // Pre-compute card results
  const results = [];
  for (const card of cards) {
    const result = checkCard(card.numbers, drawnBalls);
    results.push({ ...result, cardId: card.cardId, owner: card.owner });
  }

  // Find earliest line winner (lowest ball #, then lowest cardId for ties)
  for (const r of results) {
    if (r.lineHitBall === null) continue;
    if (
      lineWinnerBall === 0 ||
      r.lineHitBall < lineWinnerBall ||
      (r.lineHitBall === lineWinnerBall && r.cardId < lineWinnerCardId)
    ) {
      lineWinner = r.owner;
      lineWinnerBall = r.lineHitBall;
      lineWinnerCardId = r.cardId;
    }
  }

  // Find earliest bingo winner (lowest ball #, then lowest cardId for ties)
  for (const r of results) {
    if (r.bingoHitBall === null) continue;
    if (
      bingoWinnerBall === 0 ||
      r.bingoHitBall < bingoWinnerBall ||
      (r.bingoHitBall === bingoWinnerBall && r.cardId < bingoWinnerCardId)
    ) {
      bingoWinner = r.owner;
      bingoWinnerBall = r.bingoHitBall;
      bingoWinnerCardId = r.cardId;
    }
  }

  return {
    lineWinner,
    lineWinnerBall,
    lineWinnerCardId,
    bingoWinner,
    bingoWinnerBall,
    bingoWinnerCardId,
  };
}

/**
 * Sign EIP-712 ResolveRound message.
 *
 * @param {number} roundId
 * @param {string} lineWinner - address
 * @param {number} lineWinnerBall
 * @param {string} bingoWinner - address
 * @param {number} bingoWinnerBall
 * @returns {Promise<string>} signature
 */
async function signResolution(roundId, lineWinner, lineWinnerBall, bingoWinner, bingoWinnerBall) {
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
      { name: 'roundId', type: 'uint256' },
      { name: 'lineWinner', type: 'address' },
      { name: 'lineWinnerBall', type: 'uint8' },
      { name: 'bingoWinner', type: 'address' },
      { name: 'bingoWinnerBall', type: 'uint8' },
    ],
  };

  const value = {
    roundId: roundId,
    lineWinner: lineWinner,
    lineWinnerBall: lineWinnerBall,
    bingoWinner: bingoWinner,
    bingoWinnerBall: bingoWinnerBall,
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

  // 1. Fetch round from DB
  const roundResult = await pool.query(
    'SELECT * FROM bingo_rounds WHERE round_id = $1',
    [roundId]
  );
  if (roundResult.rows.length === 0) {
    throw new Error(`Round ${roundId} not found in database`);
  }
  const round = roundResult.rows[0];
  if (round.status !== 'vrf_fulfilled') {
    throw new Error(`Round ${roundId} is not in vrf_fulfilled status (current: ${round.status})`);
  }
  if (!round.vrf_random_word) {
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

  // 5. Sign EIP-712
  const signature = await signResolution(
    roundId,
    winners.lineWinner,
    winners.lineWinnerBall,
    winners.bingoWinner,
    winners.bingoWinnerBall
  );
  console.log(`[BingoResolver] Signed resolution for round ${roundId}`);

  // 6. Call contract
  const { getBingoContract } = require('../chain/bingoProvider');
  const bingoContract = getBingoContract();

  const tx = await bingoContract.resolveRound(
    roundId,
    winners.lineWinner,
    winners.lineWinnerBall,
    winners.bingoWinner,
    winners.bingoWinnerBall,
    signature
  );
  const receipt = await tx.wait();
  console.log(`[BingoResolver] resolveRound tx: ${receipt.hash}`);

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

    // Update bingo_rounds
    await client.query(
      `UPDATE bingo_rounds SET
         status = 'resolved',
         drawn_balls = $1,
         line_winner = $2,
         bingo_winner = $3,
         resolution_tx = $4,
         updated_at = NOW()
       WHERE round_id = $5`,
      [
        JSON.stringify(drawnBalls),
        winners.lineWinner !== ZERO_ADDRESS ? winners.lineWinner : null,
        winners.bingoWinner !== ZERO_ADDRESS ? winners.bingoWinner : null,
        receipt.hash,
        roundId,
      ]
    );

    // Update individual cards with hit info
    for (const card of cards) {
      const result = checkCard(card.numbers, drawnBalls);
      const isLineWinner = winners.lineWinnerCardId === card.cardId;
      const isBingoWinner = winners.bingoWinnerCardId === card.cardId;

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
