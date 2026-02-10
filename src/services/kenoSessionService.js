/**
 * Keno Session Service
 *
 * Gestiona sesiones de Keno para liquidación batch con el contrato.
 * - Crea/reanuda sesiones activas
 * - Acumula apuestas y ganancias
 * - Liquida con el contrato al cerrar sesión
 */

const pool = require('../db');
const ethers = require('ethers');

// Configuración del contrato
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;

// ABI para liquidación
const SETTLEMENT_ABI = [
  "function settleKenoSession(address _user, uint256 _netAmount, bool _isProfit) external",
  "function adminDeposit(address _user, uint256 _amount) external",
  "function adminWithdraw(address _user, uint256 _amount) external",
  "function getBalance(address _user) view returns (uint256)",
  "function userBalances(address) view returns (uint256)"
];

let provider = null;
let contract = null;
let signer = null;

/**
 * Inicializar conexión con el contrato
 */
function initContract() {
  if (!contract && CONTRACT_ADDRESS) {
    if (!OPERATOR_PRIVATE_KEY) {
      console.error('[KenoSessionService] FATAL: OPERATOR_PRIVATE_KEY not set. On-chain settlement disabled.');
      return null;
    }
    try {
      provider = new ethers.JsonRpcProvider(RPC_URL);
      signer = new ethers.Wallet(OPERATOR_PRIVATE_KEY, provider);
      contract = new ethers.Contract(CONTRACT_ADDRESS, SETTLEMENT_ABI, signer);
      console.log('[KenoSessionService] Contract initialized:', CONTRACT_ADDRESS);
    } catch (err) {
      console.error('[KenoSessionService] Error initializing contract:', err);
    }
  }
  return contract;
}

/**
 * Obtener balance del contrato para un usuario
 */
async function getContractBalance(walletAddress) {
  try {
    initContract();
    if (!contract) return 0;

    const balance = await contract.getBalance(walletAddress);
    return parseFloat(ethers.formatUnits(balance, 6));
  } catch (err) {
    console.error('[KenoSessionService] Error getting contract balance:', err);
    return 0;
  }
}

/**
 * Obtener o crear sesión activa para un usuario
 */
async function getOrCreateSession(walletAddress) {
  const wallet = walletAddress.toLowerCase();

  // Buscar sesión activa existente
  const existing = await pool.query(
    `SELECT * FROM keno_sessions WHERE wallet_address = $1 AND status = 'active'`,
    [wallet]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Crear nueva sesión
  const result = await pool.query(
    `INSERT INTO keno_sessions (wallet_address, status)
     VALUES ($1, 'active')
     RETURNING *`,
    [wallet]
  );

  console.log(`[KenoSessionService] New session created for ${wallet}`);
  return result.rows[0];
}

/**
 * Obtener sesión activa (sin crear)
 */
async function getActiveSession(walletAddress) {
  const result = await pool.query(
    `SELECT * FROM keno_sessions WHERE wallet_address = $1 AND status = 'active'`,
    [walletAddress.toLowerCase()]
  );
  return result.rows[0] || null;
}

/**
 * Actualizar sesión después de un juego
 */
async function updateSessionAfterGame(walletAddress, betAmount, payout) {
  const wallet = walletAddress.toLowerCase();

  const result = await pool.query(
    `UPDATE keno_sessions
     SET total_wagered = total_wagered + $1,
         total_won = total_won + $2,
         games_played = games_played + 1,
         updated_at = NOW()
     WHERE wallet_address = $3 AND status = 'active'
     RETURNING *`,
    [betAmount, payout, wallet]
  );

  return result.rows[0];
}

/**
 * Obtener balance virtual (pendiente de liquidación)
 * Retorna el resultado neto de la sesión actual
 */
async function getSessionNetResult(walletAddress) {
  const session = await getActiveSession(walletAddress);

  if (!session) {
    return { netResult: 0, totalWagered: 0, totalWon: 0, gamesPlayed: 0 };
  }

  const netResult = parseFloat(session.total_won) - parseFloat(session.total_wagered);

  return {
    sessionId: session.id,
    netResult,
    totalWagered: parseFloat(session.total_wagered),
    totalWon: parseFloat(session.total_won),
    gamesPlayed: session.games_played
  };
}

/**
 * Calcular balance efectivo (contrato - pérdidas pendientes + ganancias pendientes)
 */
async function getEffectiveBalance(walletAddress) {
  const contractBalance = await getContractBalance(walletAddress);
  const { netResult } = await getSessionNetResult(walletAddress);

  // Balance efectivo = balance contrato + resultado neto de sesión
  // Si netResult es negativo (perdió), resta del balance visible
  // Si netResult es positivo (ganó), suma al balance visible
  const effectiveBalance = contractBalance + netResult;

  return {
    contractBalance,
    sessionNetResult: netResult,
    effectiveBalance: Math.max(0, effectiveBalance)
  };
}

/**
 * Liquidar sesión con el contrato
 */
async function settleSession(walletAddress) {
  const wallet = walletAddress.toLowerCase();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Obtener sesión activa
    const sessionResult = await client.query(
      `SELECT * FROM keno_sessions WHERE wallet_address = $1 AND status = 'active' FOR UPDATE`,
      [wallet]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: true, message: 'No active session to settle' };
    }

    const session = sessionResult.rows[0];
    const netResult = parseFloat(session.total_won) - parseFloat(session.total_wagered);

    // Si no hay movimiento, solo cerrar sesión
    if (netResult === 0 && session.games_played === 0) {
      await client.query(
        `UPDATE keno_sessions SET status = 'settled', settled_at = NOW() WHERE id = $1`,
        [session.id]
      );
      await client.query('COMMIT');
      return { success: true, message: 'Empty session closed', netResult: 0 };
    }

    // MVP: On-chain settlement disabled (contract ABI mismatch - Phase 2 not ready)
    // Session settlement is DB-only for now. On-chain reconciliation will be added in Phase 2.
    let txHash = null;

    if (netResult !== 0) {
      console.log(`[KenoSessionService] Settling session for ${wallet}: ${netResult > 0 ? '+' : ''}${netResult.toFixed(2)} USDT (DB-only, on-chain Phase 2)`);

      // Update user balance in DB to reflect session result
      if (netResult > 0) {
        await client.query(
          'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE wallet_address = $2',
          [netResult, wallet]
        );
      } else {
        // Loss: ensure balance doesn't go below 0
        await client.query(
          'UPDATE users SET balance = GREATEST(0, balance + $1), updated_at = NOW() WHERE wallet_address = $2',
          [netResult, wallet]
        );
      }
    }

    // Marcar sesión como liquidada
    await client.query(
      `UPDATE keno_sessions
       SET status = 'settled',
           settled_at = NOW(),
           settlement_tx = $1
       WHERE id = $2`,
      [txHash, session.id]
    );

    await client.query('COMMIT');

    return {
      success: true,
      sessionId: session.id,
      netResult,
      totalWagered: parseFloat(session.total_wagered),
      totalWon: parseFloat(session.total_won),
      gamesPlayed: session.games_played,
      txHash
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[KenoSessionService] Error settling session:', err);

    // Registrar error en la sesión
    await pool.query(
      `UPDATE keno_sessions SET settlement_error = $1 WHERE wallet_address = $2 AND status = 'active'`,
      [err.message, wallet]
    );

    throw err;
  } finally {
    client.release();
  }
}

/**
 * Liquidar sesiones pendientes de un usuario (al hacer login)
 */
async function settlePendingSessions(walletAddress) {
  const wallet = walletAddress.toLowerCase();

  // Buscar sesiones activas que deberían liquidarse
  const pendingSessions = await pool.query(
    `SELECT * FROM keno_sessions
     WHERE wallet_address = $1
     AND status = 'active'
     AND games_played > 0
     AND updated_at < NOW() - INTERVAL '1 hour'`,
    [wallet]
  );

  const results = [];

  for (const session of pendingSessions.rows) {
    try {
      const result = await settleSession(wallet);
      results.push(result);
    } catch (err) {
      results.push({ success: false, sessionId: session.id, error: err.message });
    }
  }

  return results;
}

/**
 * Forzar liquidación de todas las sesiones activas antiguas (cron job)
 */
async function settleOldSessions(hoursOld = 24) {
  const oldSessions = await pool.query(
    `SELECT DISTINCT wallet_address FROM keno_sessions
     WHERE status = 'active'
     AND games_played > 0
     AND updated_at < NOW() - make_interval(hours => $1)`,
    [parseInt(hoursOld) || 24]
  );

  console.log(`[KenoSessionService] Found ${oldSessions.rows.length} old sessions to settle`);

  const results = [];

  for (const row of oldSessions.rows) {
    try {
      const result = await settleSession(row.wallet_address);
      results.push({ wallet: row.wallet_address, ...result });
    } catch (err) {
      results.push({ wallet: row.wallet_address, success: false, error: err.message });
    }
  }

  return results;
}

module.exports = {
  getOrCreateSession,
  getActiveSession,
  updateSessionAfterGame,
  getSessionNetResult,
  getEffectiveBalance,
  getContractBalance,
  settleSession,
  settlePendingSessions,
  settleOldSessions
};
