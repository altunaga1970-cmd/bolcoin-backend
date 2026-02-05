const walletService = require('../services/walletService');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../config/constants');

// =================================
// CONTROLADOR DE BILLETERA
// =================================

/**
 * Recargar balance
 * POST /api/wallet/recharge
 */
async function recharge(req, res) {
    try {
        const { amount } = req.body;
        const userId = req.user.id;

        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_RECHARGE_AMOUNT
            });
        }

        const result = await walletService.recharge(userId, parseFloat(amount));

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.RECHARGE_SUCCESS,
            data: {
                balance: result.balance,
                transaction: result.transaction
            }
        });

    } catch (error) {
        console.error('Error en recarga:', error);

        if (error.message.includes('mínimo') || error.message.includes('máximo') || error.message.includes('exceder')) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener balance actual
 * GET /api/wallet/balance
 */
async function getBalance(req, res) {
    try {
        const userId = req.user.id;

        const balance = await walletService.getBalance(userId);

        res.json({
            success: true,
            data: balance
        });

    } catch (error) {
        console.error('Error obteniendo balance:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener historial de transacciones
 * GET /api/wallet/transactions
 */
async function getTransactions(req, res) {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20, type = null } = req.query;

        const result = await walletService.getTransactionHistory(
            userId,
            {
                page: parseInt(page),
                limit: parseInt(limit),
                type
            }
        );

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error obteniendo transacciones:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

module.exports = {
    recharge,
    getBalance,
    getTransactions
};
