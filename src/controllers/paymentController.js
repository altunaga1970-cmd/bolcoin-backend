const nowPaymentsService = require('../services/nowPaymentsService');
const withdrawalService = require('../services/withdrawalService');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const pool = require('../db');

/**
 * Obtener criptomonedas disponibles
 */
async function getCurrencies(req, res) {
  try {
    const currencies = await nowPaymentsService.getAvailableCurrencies();

    res.json({
      success: true,
      data: {
        currencies: currencies
      }
    });
  } catch (error) {
    console.error('Error obteniendo currencies:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo criptomonedas disponibles'
    });
  }
}

/**
 * Obtener monto minimo para una crypto
 */
async function getMinAmount(req, res) {
  try {
    const { currency } = req.params;
    const minAmount = await nowPaymentsService.getMinPaymentAmount(currency);

    res.json({
      success: true,
      data: {
        currency,
        min_amount: minAmount
      }
    });
  } catch (error) {
    console.error('Error obteniendo min amount:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo monto minimo'
    });
  }
}

/**
 * Crear deposito
 */
async function createDeposit(req, res) {
  try {
    const { amount, currency } = req.body;
    const userId = req.user.id;

    // Validar monto
    if (!amount || amount < 1) {
      return res.status(400).json({
        success: false,
        message: 'El monto minimo es 1 USDT'
      });
    }

    if (amount > 100000) {
      return res.status(400).json({
        success: false,
        message: 'El monto maximo es 100,000 USDT'
      });
    }

    if (!currency) {
      return res.status(400).json({
        success: false,
        message: 'Debe seleccionar una criptomoneda'
      });
    }

    // Crear pago en NOWPayments
    const orderId = `dep_${userId}_${Date.now()}`;
    const payment = await nowPaymentsService.createPayment(
      amount,
      currency.toLowerCase(),
      orderId,
      `Deposito ${amount} USDT - Usuario ${userId}`
    );

    // Guardar en nuestra DB
    const savedPayment = await Payment.create(userId, {
      payment_id: payment.payment_id,
      payment_status: payment.payment_status,
      pay_address: payment.pay_address,
      pay_currency: payment.pay_currency,
      pay_amount: payment.pay_amount,
      price_amount: amount,
      expires_at: payment.expiration_estimate_date || new Date(Date.now() + 20 * 60 * 1000) // 20 min
    });

    res.json({
      success: true,
      data: {
        deposit: {
          id: savedPayment.id,
          payment_id: payment.payment_id,
          pay_address: payment.pay_address,
          pay_currency: payment.pay_currency,
          pay_amount: payment.pay_amount,
          price_amount: amount,
          status: payment.payment_status,
          expires_at: savedPayment.expires_at
        }
      }
    });

  } catch (error) {
    console.error('Error creando deposito:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creando deposito'
    });
  }
}

/**
 * Obtener estado de un deposito
 */
async function getDepositStatus(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Buscar en nuestra DB
    const payment = await Payment.findById(id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Deposito no encontrado'
      });
    }

    // Verificar que pertenece al usuario
    if (payment.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'No autorizado'
      });
    }

    // Si el pago esta pendiente, consultar NOWPayments para estado actualizado
    if (payment.payment_status === 'waiting' || payment.payment_status === 'confirming') {
      try {
        const nowStatus = await nowPaymentsService.getPaymentStatus(payment.payment_id);

        if (nowStatus.payment_status !== payment.payment_status) {
          // Actualizar estado en nuestra DB
          await Payment.updateStatus(payment.payment_id, nowStatus.payment_status, {
            actually_paid: nowStatus.actually_paid,
            outcome_amount: nowStatus.outcome_amount
          });

          // Si se completo, acreditar balance
          if (nowStatus.payment_status === 'finished') {
            await creditDeposit(payment.user_id, nowStatus.outcome_amount || payment.price_amount, payment.id);
          }

          payment.payment_status = nowStatus.payment_status;
          payment.actually_paid = nowStatus.actually_paid;
          payment.outcome_amount = nowStatus.outcome_amount;
        }
      } catch (nowError) {
        console.error('Error consultando NOWPayments:', nowError.message);
      }
    }

    res.json({
      success: true,
      data: {
        deposit: payment
      }
    });

  } catch (error) {
    console.error('Error obteniendo estado deposito:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estado del deposito'
    });
  }
}

/**
 * Obtener historial de depositos del usuario
 */
async function getDeposits(req, res) {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const result = await Payment.findByUserId(userId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error obteniendo depositos:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo historial de depositos'
    });
  }
}

/**
 * Solicitar retiro
 */
async function requestWithdrawal(req, res) {
  try {
    const { amount, currency, wallet_address } = req.body;
    const userId = req.user.id;

    // Validaciones basicas
    if (!amount || !currency || !wallet_address) {
      return res.status(400).json({
        success: false,
        message: 'Monto, criptomoneda y direccion de wallet son requeridos'
      });
    }

    const withdrawal = await withdrawalService.requestWithdrawal(
      userId,
      parseFloat(amount),
      currency.toLowerCase(),
      wallet_address
    );

    res.json({
      success: true,
      data: {
        withdrawal,
        message: withdrawal.requires_approval
          ? 'Retiro enviado para aprobacion'
          : 'Retiro procesado exitosamente'
      }
    });

  } catch (error) {
    console.error('Error en retiro:', error.message);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Obtener historial de retiros del usuario
 */
async function getWithdrawals(req, res) {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

    const result = await withdrawalService.getUserWithdrawals(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      status: status || null
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error obteniendo retiros:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo historial de retiros'
    });
  }
}

/**
 * Obtener limites de retiro
 */
async function getWithdrawalLimits(req, res) {
  try {
    const limits = withdrawalService.getWithdrawalLimits();

    res.json({
      success: true,
      data: limits
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error obteniendo limites'
    });
  }
}

/**
 * Acreditar deposito al balance del usuario
 */
async function creditDeposit(userId, amount, paymentId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Obtener usuario con lock
    const userResult = await client.query(
      'SELECT id, balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const user = userResult.rows[0];

    const newBalance = parseFloat(user.balance) + parseFloat(amount);

    // Actualizar balance
    await client.query(
      'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2',
      [newBalance, userId]
    );

    // Crear transaccion
    await client.query(
      `INSERT INTO transactions
       (user_id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, description)
       VALUES ($1, 'deposit', $2, $3, $4, 'payment', $5, $6)`,
      [
        userId,
        amount,
        user.balance,
        newBalance,
        paymentId,
        `Deposito de ${amount} USDT via crypto`
      ]
    );

    await client.query('COMMIT');
    console.log(`Deposito acreditado: ${amount} USDT a usuario ${userId}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error acreditando deposito:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getCurrencies,
  getMinAmount,
  createDeposit,
  getDepositStatus,
  getDeposits,
  requestWithdrawal,
  getWithdrawals,
  getWithdrawalLimits,
  creditDeposit
};
