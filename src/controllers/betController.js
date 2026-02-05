const betService = require('../services/betService');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../config/constants');

// =================================
// CONTROLADOR DE APUESTAS
// =================================

/**
 * Realizar apuestas
 * POST /api/bets/place
 */
async function placeBets(req, res) {
    try {
        const { draw_id, bets } = req.body;
        const userId = req.user.id;

        // Validar datos requeridos
        if (!draw_id) {
            return res.status(400).json({
                success: false,
                message: 'El ID del sorteo es requerido'
            });
        }

        if (!bets || !Array.isArray(bets) || bets.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Debe proporcionar al menos una apuesta'
            });
        }

        // Realizar apuestas
        const result = await betService.placeBets(userId, draw_id, bets);

        res.status(201).json({
            success: true,
            message: SUCCESS_MESSAGES.BET_PLACED,
            data: {
                bets: result.bets,
                new_balance: result.new_balance,
                total_cost: result.total_cost,
                bets_count: result.bets.length
            }
        });

    } catch (error) {
        console.error('Error realizando apuestas:', error);

        // Manejar errores específicos
        if (error.message.includes('Balance insuficiente') ||
            error.message.includes('inválido') ||
            error.message.includes('no está abierto') ||
            error.message.includes('no está disponible') ||
            error.message.includes('Máximo') ||
            error.message.includes('mínimo')) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        if (error.message === ERROR_MESSAGES.DRAW_NOT_FOUND) {
            return res.status(404).json({
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
 * Obtener apuestas del usuario
 * GET /api/bets/my-bets
 */
async function getMyBets(req, res) {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20, status = null, draw_id = null } = req.query;

        const filters = {
            page: parseInt(page),
            limit: parseInt(limit)
        };

        if (status) {
            filters.status = status;
        }

        if (draw_id) {
            filters.drawId = parseInt(draw_id);
        }

        const result = await betService.getUserBets(userId, filters);

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error obteniendo apuestas:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener apuesta específica
 * GET /api/bets/:id
 */
async function getBetById(req, res) {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const bet = await betService.getBetById(parseInt(id), userId);

        res.json({
            success: true,
            data: {
                bet
            }
        });

    } catch (error) {
        console.error('Error obteniendo apuesta:', error);

        if (error.message.includes('no encontrada') || error.message.includes('permiso')) {
            return res.status(404).json({
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
 * Obtener estadísticas de apuestas del usuario
 * GET /api/bets/stats
 */
async function getBetStats(req, res) {
    try {
        const userId = req.user.id;

        const stats = await betService.getUserBetStats(userId);

        res.json({
            success: true,
            data: {
                stats
            }
        });

    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

module.exports = {
    placeBets,
    getMyBets,
    getBetById,
    getBetStats
};
