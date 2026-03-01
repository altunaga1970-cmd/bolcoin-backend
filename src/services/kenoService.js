/**
 * Keno Service - Backend Logic (MVP)
 *
 * Sistema de sesiones con liquidacion batch:
 * - Balance visible = balance contrato + resultado neto sesion
 * - Juegos procesados instantaneamente en backend
 * - Liquidacion con contrato al cerrar sesion
 *
 * MVP Config:
 * - Apuesta fija: 1 USDT (bruta)
 * - Fee: 12% (1200 bps) sobre cada apuesta (siempre, gane o pierda)
 * - Apuesta efectiva: $0.88 (bruta - fee)
 * - Multiplicadores aplican sobre apuesta efectiva
 * - Max Payout: DINAMICO (10% del pool)
 *
 * Sistema de Cap Dinamico:
 * - Pool $500 → Max Payout $50
 * - Pool $750 → Max Payout $75
 * - Pool $3,000 → Max Payout $300
 * - Pool $100,000 → Max Payout $10,000 (maximo teorico)
 */

const pool = require('../db');
const crypto = require('crypto');
const kenoSessionService = require('./kenoSessionService');
const gameConfigService = require('./gameConfigService');
const kenoVrfService = require('./kenoVrfService');
const { toCents, fromCents } = require('../utils/money');
const { calculateBetCommissionByWallet } = require('./referralAdminService');

// Configuracion estatica de Keno (valores dinamicos vienen de gameConfigService)
const KENO_CONFIG = {
  TOTAL_NUMBERS: 80,      // Numeros del 1 al 80
  DRAWN_NUMBERS: 20,      // Se sortean 20 numeros
  MIN_SPOTS: 1,           // Minimo 1 numero
  MAX_SPOTS: 10,          // Maximo 10 numeros
  // MVP: Valores fijos (la BD es fuente de verdad, estos son fallback)
  BET_AMOUNT: 1,          // Apuesta fija 1 USDT
  MAX_PAYOUT: 50,         // Cap de pago maximo
  FEE_BPS: 1200,          // 12% fee sobre cada apuesta
  POOL_BPS: 8800          // 88% apuesta efectiva
};

// Tabla de pagos (spots -> hits -> multiplicador)
const PAYOUT_TABLE = {
  1: { 0: 0, 1: 3 },
  2: { 0: 0, 1: 1, 2: 9 },
  3: { 0: 0, 1: 0, 2: 2, 3: 27 },
  4: { 0: 0, 1: 0, 2: 1, 3: 5, 4: 75 },
  5: { 0: 0, 1: 0, 2: 0, 3: 3, 4: 12, 5: 300 },
  6: { 0: 0, 1: 0, 2: 0, 3: 2, 4: 5, 5: 50, 6: 1000 },
  7: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 3, 5: 20, 6: 100, 7: 2000 },
  8: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 2, 5: 10, 6: 50, 7: 500, 8: 5000 },
  9: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 5, 6: 25, 7: 200, 8: 2000, 9: 7500 },
  10: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 3, 6: 15, 7: 100, 8: 1000, 9: 5000, 10: 10000 }
};

// NOTA: Keno usa balance de base de datos (users.balance)
// No interactúa con el smart contract directamente

/**
 * Check loss limits for responsible gaming
 * @param {Object} client - DB client (within transaction)
 * @param {string} wallet - Wallet address (lowercase)
 * @param {Object} session - Active session row
 * @throws {Error} if any limit is reached
 */
async function checkLossLimits(client, wallet, session) {
  const limits = await gameConfigService.getLossLimitConfig();

  // Daily loss limit (0 = disabled)
  if (limits.dailyLossLimit > 0) {
    const dailyResult = await client.query(
      `SELECT COALESCE(SUM(ABS(net_result)), 0) as daily_loss
       FROM keno_games
       WHERE wallet_address = $1
         AND net_result < 0
         AND timestamp >= CURRENT_DATE`,
      [wallet]
    );
    const dailyLoss = fromCents(toCents(dailyResult.rows[0].daily_loss || 0));
    if (dailyLoss >= limits.dailyLossLimit) {
      throw new Error(`Limite de perdida diaria alcanzado ($${dailyLoss.toFixed(2)} / $${limits.dailyLossLimit}). Intenta manana.`);
    }
  }

  // Session loss limit (0 = disabled)
  if (limits.sessionLossLimit > 0 && session) {
    const sessionLoss = fromCents(toCents(session.total_wagered || 0) - toCents(session.total_won || 0));
    if (sessionLoss >= limits.sessionLossLimit) {
      throw new Error(`Limite de perdida de sesion alcanzado ($${sessionLoss.toFixed(2)} / $${limits.sessionLossLimit}). Cierra sesion para continuar.`);
    }
  }

  // Max games per session (0 = disabled)
  if (limits.maxGamesPerSession > 0 && session) {
    const gamesPlayed = parseInt(session.games_played || 0);
    if (gamesPlayed >= limits.maxGamesPerSession) {
      throw new Error(`Maximo de juegos por sesion alcanzado (${gamesPlayed} / ${limits.maxGamesPerSession}). Cierra sesion para continuar.`);
    }
  }
}

/**
 * Generar numeros aleatorios verificables
 * Usa crypto para generar numeros seguros
 */
function generateRandomNumbers(count, max, seed) {
  const numbers = new Set();
  let counter = 0;

  while (numbers.size < count) {
    // Crear hash determinista basado en seed y counter
    const hash = crypto.createHash('sha256')
      .update(`${seed}-${counter}`)
      .digest('hex');

    // Convertir primeros 8 chars del hash a numero
    const num = (parseInt(hash.substring(0, 8), 16) % max) + 1;
    numbers.add(num);
    counter++;
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

/**
 * Obtener balance del usuario desde la base de datos
 * (sincronizado con el contrato via BalanceContext)
 */
async function getUserBalance(walletAddress) {
  try {
    const result = await pool.query(
      'SELECT balance FROM users WHERE wallet_address = $1',
      [walletAddress.toLowerCase()]
    );
    if (result.rows.length > 0) {
      return parseFloat(result.rows[0].balance) || 0;
    }
    return 0;
  } catch (err) {
    console.error('[KenoService] Error getting user balance:', err);
    return 0;
  }
}

/**
 * Obtener balance efectivo del usuario
 * Balance efectivo = balance contrato + resultado neto de sesión activa
 */
async function getTotalBalance(walletAddress) {
  const effectiveBalance = await kenoSessionService.getEffectiveBalance(walletAddress);
  return {
    contractBalance: effectiveBalance.contractBalance,
    sessionNetResult: effectiveBalance.sessionNetResult,
    totalBalance: effectiveBalance.effectiveBalance
  };
}

/**
 * Jugar Keno (con sistema de sesiones) - MVP
 *
 * CAMBIOS MVP:
 * - Apuesta fija $1 USDT (ignora betAmount del request)
 * - Cap de pago maximo $50 USDT
 * - Fee 12% solo sobre perdidas
 * - Validacion de solvencia del contrato
 */
async function playKeno(walletAddress, selectedNumbers, betAmount, commitId = null, clientSeedInput = '') {
  const wallet = walletAddress.toLowerCase();

  // Obtener configuracion dinamica desde BD
  const config = await gameConfigService.getKenoConfig();
  const systemConfig = await gameConfigService.getSystemConfig();

  // MVP: Apuesta fija (ignora el betAmount del request)
  const bet = config.betAmount; // Siempre 1 USDT

  // Validaciones de numeros
  if (!Array.isArray(selectedNumbers) || selectedNumbers.length < config.minSpots) {
    throw new Error(`Selecciona al menos ${config.minSpots} numero`);
  }

  if (selectedNumbers.length > config.maxSpots) {
    throw new Error(`Maximo ${config.maxSpots} numeros`);
  }

  // Validar que los numeros esten en rango
  for (const num of selectedNumbers) {
    if (num < 1 || num > config.totalNumbers) {
      throw new Error(`Numero ${num} fuera de rango (1-${config.totalNumbers})`);
    }
  }

  // Validar numeros unicos
  if (new Set(selectedNumbers).size !== selectedNumbers.length) {
    throw new Error('Los numeros deben ser unicos');
  }

  // Validar que sean enteros
  for (const num of selectedNumbers) {
    if (!Number.isInteger(num)) {
      throw new Error(`Numero ${num} debe ser entero`);
    }
  }

  // Generar seeds para Provably Fair + VRF
  const timestamp = Date.now();
  let serverSeed;
  let seedHash = null;
  let usedCommitId = null;
  // Accept user-provided clientSeed for Provably Fair (sanitize to string, max 64 chars)
  const clientSeed = typeof clientSeedInput === 'string' ? clientSeedInput.slice(0, 64) : '';

  // Collision-safe game ID using crypto random
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const gameId = `KENO-${timestamp}-${randomSuffix}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // BLOCKER 7 FIX: Lock session row to prevent concurrent double-spend
    // Get or create session within transaction
    let sessionResult = await client.query(
      `SELECT * FROM keno_sessions WHERE wallet_address = $1 AND status = 'active' FOR UPDATE`,
      [wallet]
    );

    let session;
    if (sessionResult.rows.length === 0) {
      const newSession = await client.query(
        `INSERT INTO keno_sessions (wallet_address, status)
         VALUES ($1, 'active')
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [wallet]
      );
      if (newSession.rows.length === 0) {
        // Race: another transaction just created it, retry read with lock
        sessionResult = await client.query(
          `SELECT * FROM keno_sessions WHERE wallet_address = $1 AND status = 'active' FOR UPDATE`,
          [wallet]
        );
        session = sessionResult.rows[0];
      } else {
        session = newSession.rows[0];
      }
    } else {
      session = sessionResult.rows[0];
    }

    if (!session) {
      throw new Error('No se pudo crear sesion de juego');
    }

    // Verify balance INSIDE the transaction (atomic with game insert)
    const balanceResult = await client.query(
      'SELECT balance FROM users WHERE wallet_address = $1 FOR UPDATE',
      [wallet]
    );
    const userBalanceCents = balanceResult.rows.length > 0 ? toCents(balanceResult.rows[0].balance) : 0;

    // Calculate effective balance = user DB balance + session net result (integer cents)
    const sessionNetCents = toCents(session.total_won || 0) - toCents(session.total_wagered || 0);
    const effectiveBalance = fromCents(userBalanceCents + sessionNetCents);

    if (bet > effectiveBalance) {
      throw new Error(`Balance insuficiente. Tienes: $${effectiveBalance.toFixed(2)} USDT`);
    }

    // Check loss limits (responsible gaming)
    await checkLossLimits(client, wallet, session);

    // Commit-reveal: determine serverSeed source
    const commitRevealEnabled = await gameConfigService.getConfigValue('keno_commit_reveal_enabled', false);
    if (commitRevealEnabled) {
      if (!commitId) {
        throw new Error('Commit-reveal habilitado. Llama POST /api/keno/commit primero y envia commitId.');
      }
      const commitData = await kenoVrfService.consumeSeedCommit(commitId, wallet, client);
      serverSeed = commitData.server_seed;
      seedHash = commitData.seed_hash;
      usedCommitId = commitId;
    } else {
      // Legacy flow: generate seed on-the-fly
      serverSeed = kenoVrfService.generateServerSeed();
    }

    // Get nonce within transaction to prevent duplicates
    const nonceResult = await client.query(
      `SELECT COALESCE(MAX(nonce), -1) + 1 as next_nonce FROM keno_games WHERE wallet_address = $1`,
      [wallet]
    );
    const nonce = nonceResult.rows[0]?.next_nonce || 0;

    // Generar seed combinado verificable
    const seed = kenoVrfService.generateCombinedSeed(serverSeed, clientSeed, nonce);

    // Generar 20 numeros aleatorios
    const drawnNumbers = generateRandomNumbers(
      config.drawnNumbers,
      config.totalNumbers,
      seed
    );

    // Calcular aciertos
    const matchedNumbers = selectedNumbers.filter(n => drawnNumbers.includes(n));
    const hits = matchedNumbers.length;
    const spots = selectedNumbers.length;

    // Obtener multiplicador de la tabla
    const rawMultiplier = PAYOUT_TABLE[spots]?.[hits] || 0;

    // Fee 12% sobre apuesta bruta (siempre, gane o pierda)
    const { fee: feeAmount, effectiveBet } = gameConfigService.calculateBetFee(bet, config.feeBps);

    // Multiplicadores aplican sobre apuesta efectiva ($0.88)
    const { theoreticalPayout, actualPayout, capped } = gameConfigService.calculateCappedPayout(
      effectiveBet,
      rawMultiplier,
      config.maxPayout
    );

    const payout = actualPayout;
    // netResult desde perspectiva del jugador: lo que recibe - lo que pago
    const netResult = payout - bet;

    // Insertar juego (vinculado a la sesion) con seeds para VRF (nonce now from transaction)
    await client.query(
      `INSERT INTO keno_games (
        game_id, wallet_address, selected_numbers, drawn_numbers, matched_numbers,
        spots, hits, bet_amount, multiplier, payout, net_result,
        seed, timestamp, settled, session_id,
        server_seed, client_seed, nonce, vrf_verified,
        seed_hash, commit_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, $14, $15, $16, $17, false, $18, $19)`,
      [
        gameId, wallet,
        JSON.stringify(selectedNumbers),
        JSON.stringify(drawnNumbers),
        JSON.stringify(matchedNumbers),
        spots, hits, bet, rawMultiplier, payout, netResult,
        seed, new Date(timestamp), session.id,
        serverSeed, clientSeed, nonce,
        seedHash, usedCommitId
      ]
    );

    // Comision de referido (fire-and-forget, no bloquea el juego)
    calculateBetCommissionByWallet(gameId, wallet, bet).catch(() => {});

    // Actualizar sesion con los totales
    await client.query(
      `UPDATE keno_sessions
       SET total_wagered = total_wagered + $1,
           total_won = total_won + $2,
           games_played = games_played + 1,
           updated_at = NOW()
       WHERE id = $3`,
      [bet, payout, session.id]
    );

    // Fee siempre se cobra (12% de apuesta bruta). La apuesta efectiva va al pool.
    // Si gana: pool pierde el payout pero gana la apuesta efectiva → poolDelta = effectiveBet - payout
    // Si pierde (payout=0): pool gana la apuesta efectiva → poolDelta = effectiveBet
    const poolDelta = effectiveBet - payout;

    // Registrar fee (siempre, cada juego)
    await client.query(
      `INSERT INTO keno_fees (game_id, fee_amount, reserve_amount, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [gameId, feeAmount, effectiveBet]
    );

    // Actualizar pool balance y estadisticas (GREATEST prevents negative balance)
    await client.query(
      `UPDATE keno_pool
       SET balance = GREATEST(0, balance + $1),
           total_bets = total_bets + $2,
           total_payouts = total_payouts + $3,
           total_fees = total_fees + $4,
           games_played = games_played + 1,
           updated_at = NOW()
       WHERE id = 1`,
      [poolDelta, bet, payout, feeAmount]
    );

    // Invalidar cache del pool para reflejar nuevo balance
    gameConfigService.invalidatePoolBalanceCache();

    await client.query('COMMIT');

    console.log(`[KenoService] Game ${gameId}: ${spots} spots, ${hits} hits, bet $${bet} (eff $${effectiveBet.toFixed(2)}, fee $${feeAmount.toFixed(2)}), payout $${payout}${capped ? ' (CAPPED)' : ''}`);

    return {
      gameId,
      selectedNumbers: selectedNumbers.sort((a, b) => a - b),
      drawnNumbers,
      matchedNumbers,
      spots,
      hits,
      betAmount: bet,
      effectiveBet,
      feeAmount,
      multiplier: rawMultiplier,
      theoreticalPayout,
      payout,
      capped,
      maxPayout: config.maxPayout,
      netResult,
      isWin: netResult > 0,
      seed,
      timestamp,
      // VRF data for Provably Fair verification
      provablyFair: {
        serverSeed,
        clientSeed,
        nonce,
        combinedSeed: seed,
        seedHash,
        commitId: usedCommitId,
        vrfVerified: false
      }
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Obtener historial de juegos de un usuario
 */
async function getGameHistory(walletAddress, limit = 20) {
  const result = await pool.query(
    `SELECT game_id, selected_numbers, drawn_numbers, matched_numbers,
            spots, hits, bet_amount, multiplier, payout, net_result,
            timestamp, settled
     FROM keno_games
     WHERE wallet_address = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [walletAddress.toLowerCase(), limit]
  );

  return result.rows.map(row => ({
    gameId: row.game_id,
    selectedNumbers: row.selected_numbers,
    drawnNumbers: row.drawn_numbers,
    matchedNumbers: row.matched_numbers,
    spots: row.spots,
    hits: row.hits,
    betAmount: parseFloat(row.bet_amount),
    multiplier: parseFloat(row.multiplier),
    payout: parseFloat(row.payout),
    netResult: parseFloat(row.net_result),
    isWin: parseFloat(row.net_result) > 0,
    timestamp: row.timestamp,
    settled: row.settled
  }));
}

/**
 * Obtener estadisticas de Keno para admin
 */
async function getKenoStats(dateFrom = null, dateTo = null) {
  let whereClause = '';
  const params = [];

  if (dateFrom) {
    params.push(dateFrom);
    whereClause += `WHERE timestamp >= $${params.length}`;
  }

  if (dateTo) {
    params.push(dateTo);
    whereClause += whereClause ? ` AND timestamp <= $${params.length}` : `WHERE timestamp <= $${params.length}`;
  }

  const result = await pool.query(
    `SELECT
       COUNT(*) as total_games,
       COUNT(DISTINCT wallet_address) as unique_players,
       SUM(bet_amount) as total_wagered,
       SUM(payout) as total_payouts,
       SUM(CASE WHEN payout > 0 THEN 1 ELSE 0 END) as total_wins,
       SUM(CASE WHEN payout = 0 THEN 1 ELSE 0 END) as total_losses
     FROM keno_games ${whereClause}`,
    params
  );

  const feesResult = await pool.query(
    `SELECT
       COALESCE(SUM(fee_amount), 0) as total_fees,
       COALESCE(SUM(reserve_amount), 0) as total_reserve
     FROM keno_fees kf
     JOIN keno_games kg ON kf.game_id = kg.game_id
     ${whereClause}`,
    params
  );

  const stats = result.rows[0];
  const fees = feesResult.rows[0];

  return {
    totalGames: parseInt(stats.total_games) || 0,
    uniquePlayers: parseInt(stats.unique_players) || 0,
    totalWagered: parseFloat(stats.total_wagered) || 0,
    totalPayouts: parseFloat(stats.total_payouts) || 0,
    totalWins: parseInt(stats.total_wins) || 0,
    totalLosses: parseInt(stats.total_losses) || 0,
    houseEdge: parseFloat(stats.total_wagered) - parseFloat(stats.total_payouts) || 0,
    totalFees: parseFloat(fees.total_fees) || 0,
    totalReserve: parseFloat(fees.total_reserve) || 0
  };
}

/**
 * Obtener configuracion (dinamica desde BD)
 */
async function getConfig() {
  const config = await gameConfigService.getKenoConfig();

  return {
    // Config dinamica de BD
    betAmount: config.betAmount,
    maxPayout: config.maxPayout,
    feeBps: config.feeBps,
    poolBps: config.poolBps,
    minSpots: config.minSpots,
    maxSpots: config.maxSpots,
    totalNumbers: config.totalNumbers,
    drawnNumbers: config.drawnNumbers,
    // Tabla de pagos (estatica)
    payoutTable: PAYOUT_TABLE,
    // Info de pool (cap dinamico)
    pool: {
      balance: config.poolBalance,
      maxPayoutRatio: config.maxPayoutRatio,
      absoluteMaxPayout: config.absoluteMaxPayout,
      minPoolBalance: config.minPoolBalance
    },
    // Info adicional MVP
    mvp: {
      fixedBet: true,
      payoutCapped: true,
      dynamicCap: true,
      feeOnEveryBet: true
    }
  };
}

module.exports = {
  KENO_CONFIG,
  PAYOUT_TABLE,
  playKeno,
  getUserBalance,
  getTotalBalance,
  getGameHistory,
  getKenoStats,
  getConfig
};
