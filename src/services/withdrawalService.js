const pool = require('../db');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
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

  if (parseFloat(user.balance) < amount) {
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
 * Procesar un retiro (deducir balance y enviar payout)
 */
async function processWithdrawal(withdrawalId, adminId = null) {
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

    if (parseFloat(user.balance) < parseFloat(withdrawal.amount)) {
      throw new Error('Balance insuficiente');
    }

    const newBalance = parseFloat(user.balance) - parseFloat(withdrawal.amount);

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

    // Actualizar estado del retiro
    await client.query(
      `UPDATE withdrawals
       SET status = 'processing', approved_by = $1, approved_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [adminId, withdrawalId]
    );

    await client.query('COMMIT');

    // Mark withdrawal as completed (on-chain payouts handled separately)
    try {
      await Withdrawal.markCompleted(withdrawalId);
    } catch (payoutError) {
      console.error('Error completing withdrawal:', payoutError.message);
    }

    return await Withdrawal.findById(withdrawalId);

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
