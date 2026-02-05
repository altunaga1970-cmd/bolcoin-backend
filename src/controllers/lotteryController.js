const lotteryService = require('../services/lotteryService');
const { ERROR_MESSAGES } = require('../config/constants');

// =================================
// LOTTERY CONTROLLER - La Fortuna
// =================================

/**
 * Get lottery info (next draw, jackpot, etc)
 * GET /api/lottery/info
 */
async function getLotteryInfo(req, res) {
    try {
        const info = await lotteryService.getLotteryInfo();

        res.json({
            success: true,
            data: info
        });
    } catch (error) {
        console.error('Error getting lottery info:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Purchase lottery tickets
 * POST /api/lottery/tickets
 * Body: { tickets: [{ numbers: [1,2,3,4,5,6], keyNumber: 5 }] }
 */
async function purchaseTickets(req, res) {
    try {
        const { tickets } = req.body;
        const userId = req.user.id;

        if (!tickets || !Array.isArray(tickets) || tickets.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Debe proporcionar al menos un ticket'
            });
        }

        const result = await lotteryService.purchaseTickets(userId, tickets);

        res.status(201).json({
            success: true,
            message: `${result.tickets.length} ticket(s) comprado(s) exitosamente`,
            data: result
        });

    } catch (error) {
        console.error('Error purchasing tickets:', error);

        // Handle specific errors
        if (error.message.includes('Balance insuficiente') ||
            error.message.includes('Debe') ||
            error.message.includes('Maximo') ||
            error.message.includes('numeros') ||
            error.message.includes('clave') ||
            error.message.includes('cerrado')) {
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
 * Get user's lottery tickets
 * GET /api/lottery/my-tickets
 */
async function getMyTickets(req, res) {
    try {
        const userAddress = req.user.wallet_address;
        const { page = 1, limit = 20, draw_id, status } = req.query;

        const filters = {
            page: parseInt(page),
            limit: parseInt(limit)
        };

        if (draw_id) filters.drawId = parseInt(draw_id);
        if (status) filters.status = status;

        const tickets = await lotteryService.getUserTickets(userAddress, filters);

        res.json({
            success: true,
            data: {
                tickets,
                page: filters.page,
                limit: filters.limit
            }
        });

    } catch (error) {
        console.error('Error getting user tickets:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Get current jackpot
 * GET /api/lottery/jackpot
 */
async function getJackpot(req, res) {
    try {
        const jackpot = await lotteryService.getJackpotAmount();

        res.json({
            success: true,
            data: {
                jackpot,
                cap: 1000000
            }
        });

    } catch (error) {
        console.error('Error getting jackpot:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

module.exports = {
    getLotteryInfo,
    purchaseTickets,
    getMyTickets,
    getJackpot
};
