const lotteryService = require('../services/lotteryService');
const { ERROR_MESSAGES, validateLotteryNumbers } = require('../config/constants');
const Draw = require('../models/Draw');
const WinnerCalculator = require('../indexer/winnerCalculator');

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
            error.message.includes('concurrencia') ||
            error.message.includes('Debe') ||
            error.message.includes('Maximo') ||
            error.message.includes('numeros') ||
            error.message.includes('clave') ||
            error.message.includes('cerrado') ||
            error.message.includes('tickets por sorteo')) {
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
        const userAddress = req.user.address;
        const { page = 1, limit = 20, draw_id, status } = req.query;

        const allowedStatuses = ['active', 'won', 'lost', 'claimed'];
        const filters = {
            page: Math.max(1, parseInt(page) || 1),
            limit: Math.min(100, Math.max(1, parseInt(limit) || 20))
        };

        if (draw_id) filters.drawId = parseInt(draw_id);
        if (status && allowedStatuses.includes(status)) filters.status = status;

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

/**
 * Set winning numbers for a lottery draw and trigger settlement
 * PUT /api/lottery/admin/draws/:id/results
 * Body: { numbers: [1,2,3,4,5,6], keyNumber: 5 }
 */
async function setDrawResults(req, res) {
    try {
        const drawId = parseInt(req.params.id);
        const { numbers, keyNumber } = req.body;

        if (!drawId || isNaN(drawId)) {
            return res.status(400).json({ success: false, message: 'ID de sorteo invalido' });
        }

        // Validate numbers format
        if (!Array.isArray(numbers) || numbers.length !== 6) {
            return res.status(400).json({ success: false, message: 'Debe proporcionar exactamente 6 numeros' });
        }

        const validation = validateLotteryNumbers(numbers, keyNumber);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.error });
        }

        // Verify draw exists and is in correct state
        const draw = await Draw.findById(drawId);
        if (!draw) {
            return res.status(404).json({ success: false, message: 'Sorteo no encontrado' });
        }
        if (draw.draw_type !== 'lottery') {
            return res.status(400).json({ success: false, message: 'El sorteo no es de tipo lottery' });
        }
        if (draw.status === 'completed') {
            return res.status(400).json({ success: false, message: 'El sorteo ya fue resuelto' });
        }

        // Set results
        await Draw.setLotteryResults(drawId, numbers.sort((a, b) => a - b), keyNumber);
        console.log(`[LotteryAdmin] Numeros ganadores establecidos para sorteo ${drawId}: ${numbers.join(',')} + ${keyNumber}`);

        // Trigger settlement
        const settlement = await WinnerCalculator.calculateWinners(drawId);

        res.json({
            success: true,
            message: `Sorteo resuelto. ${settlement.totalWinners} ganador(es), ${settlement.totalPrize} USDT en premios.`,
            data: {
                drawId,
                winningNumbers: numbers.sort((a, b) => a - b),
                keyNumber,
                totalTickets: settlement.totalTickets,
                totalWinners: settlement.totalWinners,
                totalPrize: settlement.totalPrize,
                categoryStats: Object.fromEntries(
                    Object.entries(settlement.categoryStats).map(([cat, data]) => [cat, { count: data.count, totalPrize: data.totalPrize }])
                )
            }
        });

    } catch (error) {
        console.error('Error setting draw results:', error);
        res.status(500).json({
            success: false,
            message: error.message || ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Get winners for a completed lottery draw
 * GET /api/lottery/admin/draws/:id/winners
 */
async function getDrawWinners(req, res) {
    try {
        const drawId = parseInt(req.params.id);
        if (!drawId || isNaN(drawId)) {
            return res.status(400).json({ success: false, message: 'ID de sorteo invalido' });
        }

        const [winners, stats] = await Promise.all([
            WinnerCalculator.getWinners(drawId),
            WinnerCalculator.getCategoryStats(drawId)
        ]);

        res.json({
            success: true,
            data: { winners, categoryStats: stats }
        });
    } catch (error) {
        console.error('Error getting draw winners:', error);
        res.status(500).json({ success: false, message: ERROR_MESSAGES.SERVER_ERROR });
    }
}

/**
 * List all lottery draws
 * GET /api/lottery/admin/draws
 */
async function listLotteryDraws(req, res) {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const result = await Draw.findAll({
            page: Math.max(1, parseInt(page) || 1),
            limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
            status: status || null
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error listing lottery draws:', error);
        res.status(500).json({ success: false, message: ERROR_MESSAGES.SERVER_ERROR });
    }
}

module.exports = {
    getLotteryInfo,
    purchaseTickets,
    getMyTickets,
    getJackpot,
    setDrawResults,
    getDrawWinners,
    listLotteryDraws
};
