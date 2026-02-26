const withdrawalService = require('../services/withdrawalService');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const pool = require('../db');

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

module.exports = {
  requestWithdrawal,
  getWithdrawals,
  getWithdrawalLimits,
  getDeposits
};
