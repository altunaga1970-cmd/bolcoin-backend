const drawService = require('../services/drawService');
const { ERROR_MESSAGES } = require('../config/constants');

// =================================
// CONTROLADOR DE SORTEOS
// =================================

/**
 * Obtener sorteos activos (abiertos para apuestas)
 * GET /api/draws/active
 */
async function getActive(req, res) {
    try {
        const draws = await drawService.getActiveDraws();

        res.json({
            success: true,
            data: {
                draws,
                count: draws.length
            }
        });

    } catch (error) {
        console.error('Error obteniendo sorteos activos:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener próximos sorteos
 * GET /api/draws/upcoming
 */
async function getUpcoming(req, res) {
    try {
        const { limit = 5 } = req.query;

        const draws = await drawService.getUpcomingDraws(parseInt(limit));

        res.json({
            success: true,
            data: {
                draws,
                count: draws.length
            }
        });

    } catch (error) {
        console.error('Error obteniendo próximos sorteos:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener sorteos completados
 * GET /api/draws/completed
 */
async function getCompleted(req, res) {
    try {
        const { page = 1, limit = 20 } = req.query;

        const result = await drawService.getCompletedDraws({
            page: parseInt(page),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error obteniendo sorteos completados:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener sorteo por ID
 * GET /api/draws/:id
 */
async function getById(req, res) {
    try {
        const { id } = req.params;

        const draw = await drawService.getDrawById(parseInt(id));

        res.json({
            success: true,
            data: {
                draw
            }
        });

    } catch (error) {
        console.error('Error obteniendo sorteo:', error);

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
 * Obtener resultados de un sorteo
 * GET /api/draws/:id/results
 */
async function getResults(req, res) {
    try {
        const { id } = req.params;

        const stats = await drawService.getDrawWithStats(parseInt(id));

        res.json({
            success: true,
            data: {
                draw: stats
            }
        });

    } catch (error) {
        console.error('Error obteniendo resultados:', error);

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

module.exports = {
    getActive,
    getUpcoming,
    getCompleted,
    getById,
    getResults
};
