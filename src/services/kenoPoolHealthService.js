/**
 * Keno Pool Health Service
 *
 * Monitorea la salud del pool de Keno y ejecuta
 * liquidaciones automaticas cuando el balance es bajo.
 *
 * Caracteristicas:
 * - Verificacion de balance minimo
 * - Auto-liquidacion de sesiones ganadoras
 * - Sistema de alertas (warning/critical)
 * - Metricas de utilizacion del pool
 */

const pool = require('../db');
const gameConfigService = require('./gameConfigService');
const kenoSessionService = require('./kenoSessionService');

/**
 * Estado de salud del pool
 */
const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  WARNING: 'warning',
  CRITICAL: 'critical',
  DEPLETED: 'depleted'
};

/**
 * Verificar salud del pool
 * @returns {Object} Estado de salud con metricas
 */
async function checkPoolHealth() {
  try {
    const balance = await gameConfigService.getPoolBalance();
    const minRequired = await gameConfigService.getConfigValue('keno_min_pool_balance', 500);
    const warningThreshold = await gameConfigService.getConfigValue('keno_pool_warning_threshold', 0.30);
    const criticalThreshold = await gameConfigService.getConfigValue('keno_pool_critical_threshold', 0.15);

    // Calcular metricas
    const utilizationPercent = minRequired > 0 ? ((minRequired - balance) / minRequired) * 100 : 0;
    const healthyBalance = balance >= minRequired;
    const warningBalance = balance >= minRequired * warningThreshold && balance < minRequired;
    const criticalBalance = balance >= minRequired * criticalThreshold && balance < minRequired * warningThreshold;

    // Determinar estado
    let status = HEALTH_STATUS.HEALTHY;
    if (balance <= 0) {
      status = HEALTH_STATUS.DEPLETED;
    } else if (criticalBalance || balance < minRequired * criticalThreshold) {
      status = HEALTH_STATUS.CRITICAL;
    } else if (warningBalance || balance < minRequired) {
      status = HEALTH_STATUS.WARNING;
    }

    // Obtener total de pagos pendientes (sesiones activas con ganancias)
    const pendingPayouts = await getPendingPayouts();

    return {
      balance,
      minRequired,
      isHealthy: healthyBalance,
      status,
      utilizationPercent: Math.max(0, utilizationPercent),
      availableForPayouts: Math.max(0, balance - pendingPayouts.totalPending),
      pendingPayouts: pendingPayouts.totalPending,
      winningSessions: pendingPayouts.winningSessions,
      thresholds: {
        warning: minRequired * warningThreshold,
        critical: minRequired * criticalThreshold
      }
    };
  } catch (err) {
    console.error('[KenoPoolHealth] Error checking health:', err);
    throw err;
  }
}

/**
 * Obtener total de pagos pendientes de sesiones activas
 * @returns {Object} Total pendiente y sesiones ganadoras
 */
async function getPendingPayouts() {
  try {
    const result = await pool.query(
      `SELECT
         wallet_address,
         total_won - total_wagered as net_result,
         games_played,
         session_start,
         updated_at
       FROM keno_sessions
       WHERE status = 'active'
       AND (total_won - total_wagered) > 0
       ORDER BY (total_won - total_wagered) DESC`
    );

    const winningSessions = result.rows.map(row => ({
      walletAddress: row.wallet_address,
      netResult: parseFloat(row.net_result),
      gamesPlayed: row.games_played,
      sessionStart: row.session_start,
      updatedAt: row.updated_at
    }));

    const totalPending = winningSessions.reduce((sum, s) => sum + s.netResult, 0);

    return {
      totalPending,
      winningSessions,
      count: winningSessions.length
    };
  } catch (err) {
    console.error('[KenoPoolHealth] Error getting pending payouts:', err);
    return { totalPending: 0, winningSessions: [], count: 0 };
  }
}

/**
 * Auto-liquidar sesiones cuando el pool esta bajo
 * Liquida una sesion a la vez, empezando por las de mayor ganancia
 *
 * @returns {Object} Resultado de las liquidaciones
 */
async function autoSettleOnLowPool() {
  const results = {
    triggered: false,
    sessionsSettled: [],
    errors: [],
    poolHealthBefore: null,
    poolHealthAfter: null
  };

  try {
    // Verificar salud del pool
    const health = await checkPoolHealth();
    results.poolHealthBefore = health;

    // Solo actuar si el pool no esta saludable
    if (health.isHealthy) {
      return results;
    }

    results.triggered = true;
    console.log(`[KenoPoolHealth] Pool health: ${health.status}, balance: $${health.balance.toFixed(2)}, min required: $${health.minRequired.toFixed(2)}`);

    // Obtener sesiones ganadoras (mayor ganancia primero)
    const { winningSessions } = await getPendingPayouts();

    if (winningSessions.length === 0) {
      console.log('[KenoPoolHealth] No winning sessions to settle');
      return results;
    }

    // Liquidar una sesion a la vez hasta que el pool este saludable
    for (const session of winningSessions) {
      try {
        console.log(`[KenoPoolHealth] Auto-settling session for ${session.walletAddress} (net: $${session.netResult.toFixed(2)})`);

        const settleResult = await kenoSessionService.settleSession(session.walletAddress);

        results.sessionsSettled.push({
          wallet: session.walletAddress,
          netResult: session.netResult,
          success: settleResult.success,
          txHash: settleResult.txHash
        });

        // Re-verificar salud despues de cada liquidacion
        const newHealth = await checkPoolHealth();
        results.poolHealthAfter = newHealth;

        if (newHealth.isHealthy) {
          console.log(`[KenoPoolHealth] Pool health restored after ${results.sessionsSettled.length} settlements`);
          break;
        }

        // Pausa breve entre liquidaciones para evitar sobrecarga
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (err) {
        console.error(`[KenoPoolHealth] Error settling session for ${session.walletAddress}:`, err);
        results.errors.push({
          wallet: session.walletAddress,
          error: err.message
        });
      }
    }

    // Estado final
    if (!results.poolHealthAfter) {
      results.poolHealthAfter = await checkPoolHealth();
    }

    return results;

  } catch (err) {
    console.error('[KenoPoolHealth] Error in autoSettleOnLowPool:', err);
    results.errors.push({ error: err.message });
    return results;
  }
}

/**
 * Obtener estadisticas del pool
 * @returns {Object} Estadisticas completas
 */
async function getPoolStats() {
  try {
    const poolResult = await pool.query(
      `SELECT
         balance,
         total_bets,
         total_payouts,
         total_fees,
         games_played,
         updated_at
       FROM keno_pool WHERE id = 1`
    );

    if (poolResult.rows.length === 0) {
      return null;
    }

    const poolData = poolResult.rows[0];

    // Obtener estadisticas de sesiones
    const sessionsResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') as active_sessions,
         COUNT(*) FILTER (WHERE status = 'settled') as settled_sessions,
         SUM(total_wagered) FILTER (WHERE status = 'active') as active_wagered,
         SUM(total_won) FILTER (WHERE status = 'active') as active_won
       FROM keno_sessions`
    );

    const sessionsData = sessionsResult.rows[0];

    // Calcular salud
    const health = await checkPoolHealth();

    return {
      pool: {
        balance: parseFloat(poolData.balance),
        totalBets: parseFloat(poolData.total_bets),
        totalPayouts: parseFloat(poolData.total_payouts),
        totalFees: parseFloat(poolData.total_fees),
        gamesPlayed: parseInt(poolData.games_played),
        lastUpdate: poolData.updated_at
      },
      sessions: {
        active: parseInt(sessionsData.active_sessions) || 0,
        settled: parseInt(sessionsData.settled_sessions) || 0,
        activeWagered: parseFloat(sessionsData.active_wagered) || 0,
        activeWon: parseFloat(sessionsData.active_won) || 0
      },
      health: {
        status: health.status,
        isHealthy: health.isHealthy,
        utilizationPercent: health.utilizationPercent,
        pendingPayouts: health.pendingPayouts,
        availableForPayouts: health.availableForPayouts
      }
    };
  } catch (err) {
    console.error('[KenoPoolHealth] Error getting pool stats:', err);
    throw err;
  }
}

/**
 * Obtener historial del pool (para graficos)
 * @param {number} days - Dias de historial
 * @returns {Array} Historial de snapshots
 */
async function getPoolHistory(days = 7) {
  try {
    // Intentar obtener de tabla de historial si existe
    const result = await pool.query(
      `SELECT
         date_trunc('hour', timestamp) as hour,
         AVG(balance) as balance,
         SUM(games_count) as games,
         SUM(total_bets) as bets,
         SUM(total_payouts) as payouts
       FROM keno_pool_history
       WHERE timestamp > NOW() - make_interval(days => $1)
       GROUP BY date_trunc('hour', timestamp)
       ORDER BY hour DESC
       LIMIT 168`, // 7 dias * 24 horas
      [parseInt(days) || 7]
    );

    return result.rows.map(row => ({
      timestamp: row.hour,
      balance: parseFloat(row.balance) || 0,
      games: parseInt(row.games) || 0,
      bets: parseFloat(row.bets) || 0,
      payouts: parseFloat(row.payouts) || 0
    }));
  } catch (err) {
    // Tabla puede no existir, retornar vacio
    console.log('[KenoPoolHealth] Pool history table not found, returning empty');
    return [];
  }
}

/**
 * Registrar snapshot del pool (para historial)
 * Llamado por el scheduler periodicamente
 */
async function recordPoolSnapshot() {
  try {
    const stats = await getPoolStats();
    if (!stats) return;

    await pool.query(
      `INSERT INTO keno_pool_history (
         timestamp, balance, games_count, total_bets, total_payouts,
         active_sessions, pending_payouts
       ) VALUES (NOW(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        stats.pool.balance,
        stats.pool.gamesPlayed,
        stats.pool.totalBets,
        stats.pool.totalPayouts,
        stats.sessions.active,
        stats.health.pendingPayouts
      ]
    );
  } catch (err) {
    // Tabla puede no existir, ignorar silenciosamente
    console.log('[KenoPoolHealth] Could not record snapshot:', err.message);
  }
}

module.exports = {
  HEALTH_STATUS,
  checkPoolHealth,
  getPendingPayouts,
  autoSettleOnLowPool,
  getPoolStats,
  getPoolHistory,
  recordPoolSnapshot
};
