const pool = require('../db');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { toCents, fromCents } = require('../utils/money');
const { sendUsdtTransfer, getSigner } = require('../chain/provider');
const WITHDRAWAL_AUTO_LIMIT = parseFloat(process.env.WITHDRAWAL_AUTO_LIMIT) || 500;
const WITHDRAWAL_MIN_AMOUNT = parseFloat(process.env.WITHDRAWAL_MIN_AMOUNT) || 5;

/**
 * Solicitar un retiro
 */
async function requestWithdrawal(userId, amount, cryptoCurrency, walletAddress) {
  // Validar monto minimo
  if (amount < WITHDRAWAL_MIN_AMOUNT) {
    throw new Error(`El monto minimo de retiro es ${WITHDRAWAL_MIN_AMOUNT} USDT`);
  }

  // Verificar balance del usuario
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('Usuario no encontrado');
  }

  if (toCents(user.balance) < toCents(amount)) {
    throw new Error('Balance insuficiente para este retiro');
  }

  // Determinar si requiere aprobacion
  const requiresApproval = amount > WITHDRAWAL_AUTO_LIMIT;

  // Crear solicitud de retiro
  const withdrawal = await Withdrawal.create(userId, {
    amount,
    crypto_currency: cryptoCurrency,
    wallet_address: walletAddress,
    requires_approval: requiresApproval
  });

  // Si no requiere aprobacion, procesar automaticamente
  if (!requiresApproval) {
    try {
      await processWithdrawal(withdrawal.id, userId);
      // Refrescar datos
      return await Withdrawal.findById(withdrawal.id);
    } catch (error) {
      // Si falla el proceso automatico, dejar como pendiente
      console.error('Error en retiro automatico:', error.message);
      // Marcar como requiere aprobacion manual
      await Withdrawal.updateStatus(withdrawal.id, 'pending', {});
      return await Withdrawal.findById(withdrawal.id);
    }
  }

  return withdrawal;
}

/**
 * Restore a user's balance after a failed on-chain withdrawal.
 * Runs in its own DB connection (the original is already released).
 */
async function _restoreWithdrawalBalance(userId, amount, withdrawalId, failureReason) {
  const restoreClient = await pool.connect();
  try {
    await restoreClient.query('BEGIN');

    // Read current (deducted) balance, apply lock
    const balanceResult = await restoreClient.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const balanceBefore = balanceResult.rows[0]?.balance ?? 0;
    const restoredBalance = fromCents(toCents(balanceBefore) + toCents(amount));

    // Credit balance back
    await restoreClient.query(
      'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2',
      [restoredBalance, userId]
    );

    // Audit trail for the reversal
    await restoreClient.query(
      `INSERT INTO transactions
       (user_id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, description)
       VALUES ($1, 'refund', $2, $3, $4, 'withdrawal', $5, $6)`,
      [
        userId,
        amount,
        balanceBefore,
        restoredBalance,
        withdrawalId,
        `Reverso de retiro ${withdrawalId}: ${(failureReason || 'fallo on-chain').slice(0, 200)}`
      ]
    );

    await restoreClient.query('COMMIT');
    console.log(`[WithdrawalService] Balance restored for user ${userId}: +${amount} USDT (withdrawal ${withdrawalId})`);
  } catch (restoreError) {
    await restoreClient.query('ROLLBACK');
    // Log loudly — operator must reconcile manually
    console.error(
      `[WithdrawalService] CRITICAL: balance restore failed for user ${userId}, withdrawal ${withdrawalId}:`,
      restoreError.message
    );
    throw restoreError;
  } finally {
    restoreClient.release();
  }
}

/**
 * Procesar un retiro:
 *   Phase 1 (DB): deduct balance, create transaction record, mark 'processing'
 *   Phase 2 (on-chain): transfer USDT via operator wallet, verify receipt
 *   On phase-2 failure: restore balance and mark withdrawal 'failed'
 */
async function processWithdrawal(withdrawalId, adminId = null) {
  // Fail fast if operator wallet is not configured — before touching DB
  try { getSigner(); } catch (signerError) {
    throw new Error(`Retiro no disponible: ${signerError.message}`);
  }

  // ── Phase 1: DB transaction ───────────────────────────────────────────
  let withdrawalRow;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Obtener retiro con lock
    const withdrawalResult = await client.query(
      'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
      [withdrawalId]
    );
    const withdrawal = withdrawalResult.rows[0];

    if (!withdrawal) {
      throw new Error('Retiro no encontrado');
    }

    if (withdrawal.status !== 'pending' && withdrawal.status !== 'approved') {
      throw new Error(`No se puede procesar un retiro con estado: ${withdrawal.status}`);
    }

    // Verificar y deducir balance del usuario
    const userResult = await client.query(
      'SELECT id, balance, version FROM users WHERE id = $1 FOR UPDATE',
      [withdrawal.user_id]
    );
    const user = userResult.rows[0];

    if (toCents(user.balance) < toCents(withdrawal.amount)) {
      throw new Error('Balance insuficiente');
    }

    const newBalance = fromCents(toCents(user.balance) - toCents(withdrawal.amount));

    // Actualizar balance
    await client.query(
      'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2',
      [newBalance, user.id]
    );

    // Crear transaccion de retiro
    await client.query(
      `INSERT INTO transactions
       (user_id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, description)
       VALUES ($1, 'withdrawal', $2, $3, $4, 'withdrawal', $5, $6)`,
      [
        user.id,
        -Math.abs(withdrawal.amount),
        user.balance,
        newBalance,
        withdrawal.id,
        `Retiro de ${withdrawal.amount} USDT a ${withdrawal.crypto_currency.toUpperCase()}`
      ]
    );

    // Marcar como en proceso
    await client.query(
      `UPDATE withdrawals
       SET status = 'processing', approved_by = $1, approved_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [adminId, withdrawalId]
    );

    await client.query('COMMIT');
    withdrawalRow = withdrawal; // save for phase 2

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // ── Phase 2: on-chain transfer ────────────────────────────────────────
  try {
    const txHash = await sendUsdtTransfer(withdrawalRow.wallet_address, withdrawalRow.amount);
    await Withdrawal.markCompleted(withdrawalId, txHash);
  } catch (payoutError) {
    console.error('[WithdrawalService] On-chain transfer failed:', payoutError.message);
    // Balance was already deducted — restore it
    await _restoreWithdrawalBalance(
      withdrawalRow.user_id,
      withdrawalRow.amount,
      withdrawalId,
      payoutError.message
    );
    throw new Error('Retiro fallido: transferencia on-chain no completada. Balance restaurado.');
  }

  return await Withdrawal.findById(withdrawalId);
}

/**
 * Aprobar un retiro pendiente (admin)
 */
async function approveWithdrawal(withdrawalId, adminId) {
  const withdrawal = await Withdrawal.findById(withdrawalId);

  if (!withdrawal) {
    throw new Error('Retiro no encontrado');
  }

  if (withdrawal.status !== 'pending') {
    throw new Error(`No se puede aprobar un retiro con estado: ${withdrawal.status}`);
  }

  // Aprobar y procesar
  await Withdrawal.approve(withdrawalId, adminId);
  return await processWithdrawal(withdrawalId, adminId);
}

/**
 * Rechazar un retiro pendiente (admin)
 */
async function rejectWithdrawal(withdrawalId, adminId, reason) {
  const withdrawal = await Withdrawal.findById(withdrawalId);

  if (!withdrawal) {
    throw new Error('Retiro no encontrado');
  }

  if (withdrawal.status !== 'pending') {
    throw new Error(`No se puede rechazar un retiro con estado: ${withdrawal.status}`);
  }

  if (!reason || !reason.trim()) {
    throw new Error('Debe proporcionar una razon para el rechazo');
  }

  return await Withdrawal.reject(withdrawalId, adminId, reason);
}

/**
 * Obtener retiros de un usuario
 */
async function getUserWithdrawals(userId, options = {}) {
  return await Withdrawal.findByUserId(userId, options);
}

/**
 * Obtener retiros pendientes de aprobacion (admin)
 */
async function getPendingWithdrawals(options = {}) {
  return await Withdrawal.findPendingApproval(options);
}

/**
 * Obtener todos los retiros (admin)
 */
async function getAllWithdrawals(options = {}) {
  return await Withdrawal.findAll(options);
}

/**
 * Obtener limites de retiro
 */
function getWithdrawalLimits() {
  return {
    min: WITHDRAWAL_MIN_AMOUNT,
    autoLimit: WITHDRAWAL_AUTO_LIMIT
  };
}

module.exports = {
  requestWithdrawal,
  processWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
  getUserWithdrawals,
  getPendingWithdrawals,
  getAllWithdrawals,
  getWithdrawalLimits
};
