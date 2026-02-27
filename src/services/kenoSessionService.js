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
const crypto = require('crypto');
const gameConfigService = require('./gameConfigService');

// Configuración del contrato
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CONTRACT_ADDRESS = process.env.KENO_CONTRACT_ADDRESS;
// When KENO_CONTRACT_ADDRESS is set the contract is the on-chain VRF game (not the
// Phase-2 settlement contract). The session service is not used for gameplay in this mode.
const KENO_ON_CHAIN = !!CONTRACT_ADDRESS;
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;

// ABI para liquidación (Phase 3: 5 parameters with sessionId + signature)
const SETTLEMENT_ABI = [
  "function settleKenoSession(address _user, uint256 _netAmount, bool _isProfit, bytes32 _sessionId, bytes _signature) external",
  "function adminDeposit(address _user, uint256 _amount) external",
  "function adminWithdraw(address _user, uint256 _amount) external",
  "function getBalance(address _user) view returns (uint256)",
  "function userBalances(address) view returns (uint256)"
];

// EIP-712 Domain and Types for settlement signing
const EIP712_DOMAIN_NAME = 'KenoGame';
const EIP712_DOMAIN_VERSION = '1';
const EIP712_TYPES = {
  SettleKenoSession: [
    { name: 'user', type: 'address' },
    { name: 'netAmount', type: 'uint256' },
    { name: 'isProfit', type: 'bool' },
    { name: 'sessionId', type: 'bytes32' }
  ]
};

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
 * Sign a settlement with EIP-712 using the operator wallet
 * @param {string} userAddress - Player wallet address
 * @param {BigInt} netAmountWei - Net amount in wei (USDT 6 decimals)
 * @param {boolean} isProfit - True if player profited
 * @param {string} sessionIdBytes32 - Session ID as bytes32
 * @returns {string} EIP-712 signature
 */
async function signSettlement(userAddress, netAmountWei, isProfit, sessionIdBytes32) {
  if (!signer) {
    initContract();
  }
  if (!signer) {
    throw new Error('Operator signer not available for EIP-712 signing');
  }

  const { chainId } = await provider.getNetwork();

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: chainId,
    verifyingContract: CONTRACT_ADDRESS
  };

  const value = {
    user: userAddress,
    netAmount: netAmountWei,
    isProfit: isProfit,
    sessionId: sessionIdBytes32
  };

  const signature = await signer.signTypedData(domain, EIP712_TYPES, value);
  return signature;
}

/**
 * Obtener balance del contrato para un usuario
 * En modo off-chain (sin CONTRACT_ADDRESS), lee users.balance de la DB
 */
async function getContractBalance(walletAddress) {
  try {
    // On-chain VRF mode: KENO_CONTRACT_ADDRESS is the game contract, not the
    // Phase-2 settlement contract. Session balances are irrelevant — return 0.
    if (KENO_ON_CHAIN) return 0;

    initContract();

    // Off-chain mode: read balance from DB instead of contract
    if (!contract) {
      const result = await pool.query(
        'SELECT balance FROM users WHERE wallet_address = $1',
        [walletAddress.toLowerCase()]
      );
      return result.rows[0] ? parseFloat(result.rows[0].balance) : 0;
    }

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

    let txHash = null;
    const settlementEnabled = await gameConfigService.getConfigValue('keno_settlement_enabled', false);

    if (netResult !== 0) {
      // Always update DB balance
      if (netResult > 0) {
        await client.query(
          'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE wallet_address = $2',
          [netResult, wallet]
        );
      } else {
        await client.query(
          'UPDATE users SET balance = GREATEST(0, balance + $1), updated_at = NOW() WHERE wallet_address = $2',
          [netResult, wallet]
        );
      }

      // On-chain settlement (Phase 3)
      if (settlementEnabled && CONTRACT_ADDRESS) {
        try {
          initContract();
          if (contract && signer) {
            const absAmount = Math.abs(netResult);
            const isProfit = netResult > 0;
            const netAmountWei = ethers.parseUnits(absAmount.toFixed(6), 6);

            // Generate bytes32 sessionId from DB session id
            const sessionIdHex = ethers.zeroPadValue(
              ethers.toBeHex(session.id),
              32
            );

            // Sign with EIP-712 (4 fields matching contract SETTLE_TYPEHASH)
            const signature = await signSettlement(wallet, netAmountWei, isProfit, sessionIdHex);

            // Call contract with 5 params
            const tx = await contract.settleKenoSession(
              wallet,
              netAmountWei,
              isProfit,
              sessionIdHex,
              signature
            );
            const receipt = await tx.wait();
            txHash = receipt.hash;

            console.log(`[KenoSessionService] On-chain settlement for ${wallet}: ${isProfit ? '+' : '-'}${absAmount.toFixed(2)} USDT, tx: ${txHash}`);
          }
        } catch (chainErr) {
          console.error(`[KenoSessionService] On-chain settlement failed for ${wallet}, DB updated but chain diverged:`, chainErr.message);
          // Mark as settlement_failed (not settled) so reconciliation can retry
          await client.query(
            `UPDATE keno_sessions SET status = 'settlement_failed', settlement_error = $1 WHERE id = $2`,
            [`on-chain failed: ${chainErr.message}`, session.id]
          );
          await client.query('COMMIT');
          return {
            success: false,
            sessionId: session.id,
            netResult,
            error: 'On-chain settlement failed. DB updated. Reconciliation pending.',
            txHash: null
          };
        }
      } else {
        console.log(`[KenoSessionService] Settling session for ${wallet}: ${netResult > 0 ? '+' : ''}${netResult.toFixed(2)} USDT (DB-only)`);
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
  settleOldSessions,
  // Exported for testing EIP-712 signature structure
  signSettlement
};
