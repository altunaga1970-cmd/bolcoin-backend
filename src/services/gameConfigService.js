/**
 * Game Config Service
 *
 * Gestiona configuracion dinamica de juegos desde PostgreSQL.
 * Fuente de verdad para: betAmount, fees, maxPayout, etc.
 *
 * MVP Keno:
 * - betAmount: 1 USDT (fijo)
 * - feeBps: 1200 (12% fee sobre cada apuesta, siempre)
 * - effectiveBet: betAmount * (1 - feeBps/10000) = $0.88
 * - Multiplicadores aplican sobre effectiveBet
 * - maxPayout: DINAMICO basado en pool (10% del pool)
 *
 * Sistema de Cap Dinamico:
 * - Pool $500 → Max Payout $50
 * - Pool $750 → Max Payout $75
 * - Pool $3,000 → Max Payout $300
 * - Pool $100,000 → Max Payout $10,000 (maximo teorico)
 */

const pool = require('../db');

// Cache de config (60 segundos)
let configCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000;

// Cache de pool balance (10 segundos - mas frecuente)
let poolBalanceCache = null;
let poolBalanceCacheTimestamp = 0;
const POOL_BALANCE_CACHE_TTL_MS = 10 * 1000;

// Valores por defecto MVP (fallback si BD no disponible)
const MVP_DEFAULTS = {
  // Keno
  keno_bet_amount: 1,
  keno_fee_bps: 1200,       // 12%
  keno_pool_bps: 8800,      // 88%
  keno_max_payout_ratio: 0.10,  // 10% del pool
  keno_min_pool_balance: 500,   // Pool minimo para operar
  keno_absolute_max_payout: 10000, // Maximo absoluto ($10,000)
  keno_min_spots: 1,
  keno_max_spots: 10,
  keno_total_numbers: 80,
  keno_drawn_numbers: 20,
  // Keno Session Limits
  keno_max_session_hours: 24,       // Auto-liquidar sesiones despues de 24 horas
  keno_settle_warning_hours: 20,    // Mostrar warning en UI a las 20 horas
  // Keno Pool Health
  keno_pool_warning_threshold: 0.30,  // Warning cuando pool < 30% del minimo
  keno_pool_critical_threshold: 0.15, // Critical cuando pool < 15% del minimo
  // Keno Loss Limits (0 = disabled)
  keno_daily_loss_limit: 100,
  keno_session_loss_limit: 50,
  keno_max_games_per_session: 200,
  // Keno Phase 3 Feature Flags
  keno_commit_reveal_enabled: false,
  keno_settlement_enabled: false,
  keno_commit_ttl_seconds: 300,
  // Sistema
  contract_min_balance: 100,
  rng_method: 'sha256_server_seed'
};

/**
 * Invalidar cache
 */
function invalidateCache() {
  configCache = null;
  cacheTimestamp = 0;
  console.log('[GameConfig] Cache invalidated');
}

/**
 * Verificar si el cache es valido
 */
function isCacheValid() {
  return configCache && (Date.now() - cacheTimestamp) < CACHE_TTL_MS;
}

/**
 * Obtener toda la configuracion desde BD o cache
 */
async function getAllConfig() {
  if (isCacheValid()) {
    return configCache;
  }

  try {
    const result = await pool.query(
      'SELECT key, value, value_type FROM game_config'
    );

    const config = { ...MVP_DEFAULTS }; // Empezar con defaults

    for (const row of result.rows) {
      // Convertir valor segun tipo
      let parsedValue = row.value;
      switch (row.value_type) {
        case 'number':
          parsedValue = parseFloat(row.value);
          break;
        case 'boolean':
          parsedValue = row.value === 'true' || row.value === '1';
          break;
        case 'json':
          try {
            parsedValue = JSON.parse(row.value);
          } catch (e) {
            parsedValue = row.value;
          }
          break;
        default:
          parsedValue = row.value;
      }
      config[row.key] = parsedValue;
    }

    // Actualizar cache
    configCache = config;
    cacheTimestamp = Date.now();

    return config;

  } catch (err) {
    console.error('[GameConfig] Error getting config:', err);
    return MVP_DEFAULTS;
  }
}

/**
 * Obtener un valor de configuracion especifico
 */
async function getConfigValue(key, defaultValue = null) {
  const config = await getAllConfig();
  return config[key] !== undefined ? config[key] : (defaultValue ?? MVP_DEFAULTS[key]);
}

/**
 * Obtener balance actual del pool de Keno
 * Fuentes: tabla keno_pool o balance del contrato
 */
async function getPoolBalance() {
  // Verificar cache
  if (poolBalanceCache !== null && (Date.now() - poolBalanceCacheTimestamp) < POOL_BALANCE_CACHE_TTL_MS) {
    return poolBalanceCache;
  }

  try {
    // Intentar obtener de tabla keno_pool
    const result = await pool.query(
      `SELECT balance FROM keno_pool WHERE id = 1`
    );

    if (result.rows.length > 0) {
      const balance = parseFloat(result.rows[0].balance) || 0;
      poolBalanceCache = balance;
      poolBalanceCacheTimestamp = Date.now();
      return balance;
    }

    // Fallback: crear registro inicial si no existe
    await pool.query(
      `INSERT INTO keno_pool (id, balance, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [MVP_DEFAULTS.keno_min_pool_balance]
    );

    poolBalanceCache = MVP_DEFAULTS.keno_min_pool_balance;
    poolBalanceCacheTimestamp = Date.now();
    return MVP_DEFAULTS.keno_min_pool_balance;

  } catch (err) {
    console.error('[GameConfig] Error getting pool balance:', err);
    // Fallback a minimo
    return MVP_DEFAULTS.keno_min_pool_balance;
  }
}

/**
 * Actualizar balance del pool
 * @param {number} delta - Cambio en el balance (positivo o negativo)
 */
async function updatePoolBalance(delta) {
  try {
    const result = await pool.query(
      `UPDATE keno_pool
       SET balance = balance + $1, updated_at = NOW()
       WHERE id = 1
       RETURNING balance`,
      [delta]
    );

    if (result.rows.length > 0) {
      const newBalance = parseFloat(result.rows[0].balance);
      poolBalanceCache = newBalance;
      poolBalanceCacheTimestamp = Date.now();
      console.log(`[GameConfig] Pool balance updated: ${delta > 0 ? '+' : ''}${delta} → ${newBalance}`);
      return newBalance;
    }

    return await getPoolBalance();
  } catch (err) {
    console.error('[GameConfig] Error updating pool balance:', err);
    throw err;
  }
}

/**
 * Calcular max payout dinamico basado en pool
 * Formula: maxPayout = min(poolBalance * 10%, absoluteMax)
 */
function calculateDynamicMaxPayout(poolBalance, ratio = 0.10, absoluteMax = 10000) {
  const dynamicMax = poolBalance * ratio;
  return Math.min(dynamicMax, absoluteMax);
}

/**
 * Obtener configuracion de Keno (con max payout dinamico)
 */
async function getKenoConfig() {
  const config = await getAllConfig();
  const poolBalance = await getPoolBalance();

  const ratio = config.keno_max_payout_ratio || MVP_DEFAULTS.keno_max_payout_ratio;
  const absoluteMax = config.keno_absolute_max_payout || MVP_DEFAULTS.keno_absolute_max_payout;
  const dynamicMaxPayout = calculateDynamicMaxPayout(poolBalance, ratio, absoluteMax);

  return {
    betAmount: config.keno_bet_amount || MVP_DEFAULTS.keno_bet_amount,
    feeBps: config.keno_fee_bps || MVP_DEFAULTS.keno_fee_bps,
    poolBps: config.keno_pool_bps || MVP_DEFAULTS.keno_pool_bps,
    maxPayout: dynamicMaxPayout,
    maxPayoutRatio: ratio,
    absoluteMaxPayout: absoluteMax,
    poolBalance: poolBalance,
    minPoolBalance: config.keno_min_pool_balance || MVP_DEFAULTS.keno_min_pool_balance,
    minSpots: config.keno_min_spots || MVP_DEFAULTS.keno_min_spots,
    maxSpots: config.keno_max_spots || MVP_DEFAULTS.keno_max_spots,
    totalNumbers: config.keno_total_numbers || MVP_DEFAULTS.keno_total_numbers,
    drawnNumbers: config.keno_drawn_numbers || MVP_DEFAULTS.keno_drawn_numbers
  };
}

/**
 * Obtener configuracion del sistema
 */
async function getSystemConfig() {
  const config = await getAllConfig();

  return {
    contractMinBalance: config.contract_min_balance || MVP_DEFAULTS.contract_min_balance,
    rngMethod: config.rng_method || MVP_DEFAULTS.rng_method
  };
}

/**
 * Actualizar un valor de configuracion (admin only)
 */
async function setConfigValue(key, value, valueType = 'string') {
  try {
    // Convertir valor a string para almacenar
    let stringValue = value;
    if (typeof value === 'object') {
      stringValue = JSON.stringify(value);
      valueType = 'json';
    } else if (typeof value === 'boolean') {
      stringValue = value ? 'true' : 'false';
      valueType = 'boolean';
    } else if (typeof value === 'number') {
      stringValue = value.toString();
      valueType = 'number';
    }

    const result = await pool.query(
      `INSERT INTO game_config (key, value, value_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         value_type = EXCLUDED.value_type,
         updated_at = NOW()
       RETURNING *`,
      [key, stringValue, valueType]
    );

    // Invalidar cache
    invalidateCache();

    console.log(`[GameConfig] Config '${key}' set to '${stringValue}'`);
    return result.rows[0];

  } catch (err) {
    console.error('[GameConfig] Error setting config:', err);
    throw err;
  }
}

/**
 * Calcular fee y apuesta efectiva a partir de la apuesta bruta.
 * El fee (12%) se cobra SIEMPRE (gane o pierda).
 * Los multiplicadores de la tabla aplican sobre effectiveBet.
 *
 * @param {number} grossBet - Apuesta bruta del jugador (ej: $1.00)
 * @param {number} feeBps - Fee en basis points (default 1200 = 12%)
 * @returns {Object} { fee, effectiveBet, grossBet }
 */
function calculateBetFee(grossBet, feeBps = 1200) {
  // Round fee DOWN (truncate) — remainder goes to effective bet
  const fee = Math.floor((grossBet * feeBps) / 10000 * 1000000) / 1000000;
  const effectiveBet = Math.round((grossBet - fee) * 1000000) / 1000000;

  return {
    fee,
    effectiveBet,
    grossBet
  };
}

/**
 * @deprecated Use calculateBetFee instead. Kept for backward compatibility.
 */
function calculateLossDistribution(loss, feeBps = 1200, poolBps = 8800) {
  const fee = Math.floor((loss * feeBps) / 10000 * 1000000) / 1000000;
  const reserve = Math.round((loss - fee) * 1000000) / 1000000;
  return { fee, reserve, total: loss };
}

/**
 * Calcular payout con cap dinamico aplicado.
 * bet debe ser la apuesta efectiva (ya descontado el fee).
 *
 * @param {number} bet - Apuesta efectiva (grossBet - fee)
 * @param {number} multiplier - Multiplicador ganado
 * @param {number} maxPayout - Cap maximo (dinamico basado en pool)
 * @returns {Object} { theoreticalPayout, actualPayout, capped, maxPayout }
 */
function calculateCappedPayout(bet, multiplier, maxPayout) {
  const theoreticalPayout = bet * multiplier;
  const actualPayout = Math.min(theoreticalPayout, maxPayout);

  return {
    theoreticalPayout,
    actualPayout,
    capped: theoreticalPayout > maxPayout,
    maxPayout
  };
}

/**
 * Invalidar cache del pool balance
 */
function invalidatePoolBalanceCache() {
  poolBalanceCache = null;
  poolBalanceCacheTimestamp = 0;
}

/**
 * Fee se cobra siempre sobre cada apuesta (gane o pierda).
 * @returns {boolean} Siempre true
 */
function shouldChargeFee() {
  return true;
}

/**
 * Obtener config publica (para /api/public-config)
 */
async function getPublicConfig() {
  const kenoConfig = await getKenoConfig();
  const systemConfig = await getSystemConfig();

  return {
    keno: {
      betAmount: kenoConfig.betAmount,
      feeBps: kenoConfig.feeBps,
      poolBps: kenoConfig.poolBps,
      // Max payout dinamico
      maxPayout: kenoConfig.maxPayout,
      maxPayoutRatio: kenoConfig.maxPayoutRatio,
      absoluteMaxPayout: kenoConfig.absoluteMaxPayout,
      poolBalance: kenoConfig.poolBalance,
      minPoolBalance: kenoConfig.minPoolBalance,
      // Configuracion del juego
      minSpots: kenoConfig.minSpots,
      maxSpots: kenoConfig.maxSpots,
      totalNumbers: kenoConfig.totalNumbers,
      drawnNumbers: kenoConfig.drawnNumbers
    },
    system: {
      rngMethod: systemConfig.rngMethod
    }
  };
}

/**
 * Get loss limit configuration
 * Values of 0 mean no limit (backward compatible)
 */
async function getLossLimitConfig() {
  const config = await getAllConfig();
  return {
    dailyLossLimit: config.keno_daily_loss_limit ?? MVP_DEFAULTS.keno_daily_loss_limit,
    sessionLossLimit: config.keno_session_loss_limit ?? MVP_DEFAULTS.keno_session_loss_limit,
    maxGamesPerSession: config.keno_max_games_per_session ?? MVP_DEFAULTS.keno_max_games_per_session
  };
}

module.exports = {
  getAllConfig,
  getConfigValue,
  getKenoConfig,
  getSystemConfig,
  getPublicConfig,
  setConfigValue,
  // Pool management
  getPoolBalance,
  updatePoolBalance,
  calculateDynamicMaxPayout,
  invalidatePoolBalanceCache,
  // Calculations
  calculateBetFee,
  calculateLossDistribution,
  calculateCappedPayout,
  shouldChargeFee,
  invalidateCache,
  // Loss limits
  getLossLimitConfig,
  MVP_DEFAULTS
};
