const drawService = require('../services/drawService');
const payoutService = require('../services/payoutService');
const walletService = require('../services/walletService');
const withdrawalService = require('../services/withdrawalService');
const Bet = require('../models/Bet');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../config/constants');

// =================================
// CONTROLADOR DE ADMINISTRACIÓN
// =================================

/**
 * Crear nuevo sorteo
 * POST /api/admin/draws
 */
async function createDraw(req, res) {
    try {
        const { draw_number, scheduled_time } = req.body;

        const draw = await drawService.createDraw({ draw_number, scheduled_time });

        res.status(201).json({
            success: true,
            message: SUCCESS_MESSAGES.DRAW_CREATED,
            data: {
                draw
            }
        });

    } catch (error) {
        console.error('Error creando sorteo:', error);

        if (error.message.includes('ya existe') || error.message.includes('futuro')) {
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
 * Ingresar numeros ganadores y procesar pagos
 * PUT /api/admin/draws/:id/results
 * Body: { fijos: "XX", centenas: "XXX", parles: "XXXX" }
 */
async function enterResults(req, res) {
    try {
        const { id } = req.params;
        const { fijos, centenas, parles } = req.body;

        const winningNumbers = { fijos, centenas, parles };

        // Validar numeros ganadores
        payoutService.validateWinningNumbers(winningNumbers);

        // Verificar que el sorteo existe
        await drawService.getDrawById(parseInt(id));

        // Procesar resultados y distribuir pagos
        const result = await payoutService.processDrawResults(parseInt(id), winningNumbers);

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.RESULTS_ENTERED,
            data: {
                winning_numbers: winningNumbers,
                winners_count: result.winners_count,
                total_payouts: result.total_payouts,
                bets_processed: result.bets_processed
            }
        });

    } catch (error) {
        console.error('Error ingresando resultados:', error);

        if (error.message.includes('no encontrado') ||
            error.message.includes('ya fue procesado') ||
            error.message.includes('digitos')) {
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
 * Listar todos los sorteos
 * GET /api/admin/draws
 */
async function listDraws(req, res) {
    try {
        const { page = 1, limit = 50, status = null } = req.query;

        const result = await drawService.listDraws({
            page: parseInt(page),
            limit: parseInt(limit),
            status
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error listando sorteos:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener estadísticas de un sorteo
 * GET /api/admin/draws/:id/stats
 */
async function getDrawStats(req, res) {
    try {
        const { id } = req.params;

        const stats = await payoutService.calculateDrawPayoutStats(parseInt(id));
        const winners = await payoutService.getDrawWinners(parseInt(id));

        res.json({
            success: true,
            data: {
                stats,
                winners
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

/**
 * Abrir sorteo para apuestas
 * PUT /api/admin/draws/:id/open
 */
async function openDraw(req, res) {
    try {
        const { id } = req.params;

        const draw = await drawService.openDraw(parseInt(id));

        res.json({
            success: true,
            message: 'Sorteo abierto para apuestas',
            data: {
                draw
            }
        });

    } catch (error) {
        console.error('Error abriendo sorteo:', error);

        if (error.message.includes('no encontrado') || error.message.includes('Solo se pueden')) {
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
 * Cerrar sorteo
 * PUT /api/admin/draws/:id/close
 */
async function closeDraw(req, res) {
    try {
        const { id } = req.params;

        const draw = await drawService.closeDraw(parseInt(id));

        res.json({
            success: true,
            message: 'Sorteo cerrado',
            data: {
                draw
            }
        });

    } catch (error) {
        console.error('Error cerrando sorteo:', error);

        if (error.message.includes('no encontrado') || error.message.includes('Solo se pueden')) {
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
 * Listar usuarios
 * GET /api/admin/users
 */
async function listUsers(req, res) {
    try {
        const { page = 1, limit = 50, search = '', role = null } = req.query;

        const result = await User.findAll({
            page: parseInt(page),
            limit: parseInt(limit),
            search,
            role
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error listando usuarios:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener usuario por ID
 * GET /api/admin/users/:id
 */
async function getUserById(req, res) {
    try {
        const { id } = req.params;

        const user = await User.findById(parseInt(id));

        if (!user) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        // Obtener estadísticas del usuario
        const stats = await User.getStats(parseInt(id));

        res.json({
            success: true,
            data: {
                user: {
                    ...user,
                    password_hash: undefined // No enviar el hash de contraseña
                },
                stats
            }
        });

    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Ajustar balance de usuario
 * PUT /api/admin/users/:id/balance
 */
async function adjustBalance(req, res) {
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;
        const adminId = req.user.id;

        const result = await walletService.adjustBalance(
            parseInt(id),
            parseFloat(amount),
            reason,
            adminId
        );

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.UPDATE_SUCCESS,
            data: {
                balance: result.balance,
                transaction: result.transaction
            }
        });

    } catch (error) {
        console.error('Error ajustando balance:', error);

        if (error.message.includes('no encontrado') ||
            error.message.includes('negativo') ||
            error.message.includes('exceder')) {
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
 * Listar apuestas
 * GET /api/admin/bets
 */
async function listBets(req, res) {
    try {
        const { page = 1, limit = 50, userId = null, drawId = null, status = null } = req.query;

        const result = await Bet.findAll({
            page: parseInt(page),
            limit: parseInt(limit),
            userId: userId ? parseInt(userId) : null,
            drawId: drawId ? parseInt(drawId) : null,
            status
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error listando apuestas:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener estadísticas del sistema
 * GET /api/admin/statistics
 */
async function getStatistics(req, res) {
    try {
        const financialSummary = await Transaction.getSystemFinancialSummary();

        // Obtener conteos
        const { query } = require('../config/database');

        const usersResult = await query('SELECT COUNT(*) FROM users');
        const drawsResult = await query('SELECT COUNT(*) FROM draws');
        const betsResult = await query('SELECT COUNT(*) FROM bets WHERE is_corrido_child = false');

        res.json({
            success: true,
            data: {
                users: {
                    total: parseInt(usersResult.rows[0].count)
                },
                draws: {
                    total: parseInt(drawsResult.rows[0].count)
                },
                bets: {
                    total: parseInt(betsResult.rows[0].count)
                },
                financial: financialSummary
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

/**
 * Listar retiros
 * GET /api/admin/withdrawals
 */
async function listWithdrawals(req, res) {
    try {
        const { page = 1, limit = 50, status = null } = req.query;

        const result = await withdrawalService.getAllWithdrawals({
            page: parseInt(page),
            limit: parseInt(limit),
            status
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error listando retiros:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Aprobar retiro
 * PUT /api/admin/withdrawals/:id/approve
 */
async function approveWithdrawal(req, res) {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        const withdrawal = await withdrawalService.approveWithdrawal(parseInt(id), adminId);

        res.json({
            success: true,
            message: 'Retiro aprobado y procesado',
            data: {
                withdrawal
            }
        });

    } catch (error) {
        console.error('Error aprobando retiro:', error);

        if (error.message.includes('no encontrado') ||
            error.message.includes('No se puede') ||
            error.message.includes('insuficiente')) {
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
 * Rechazar retiro
 * PUT /api/admin/withdrawals/:id/reject
 */
async function rejectWithdrawal(req, res) {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const adminId = req.user.id;

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Debe proporcionar una razon para el rechazo'
            });
        }

        const withdrawal = await withdrawalService.rejectWithdrawal(parseInt(id), adminId, reason);

        res.json({
            success: true,
            message: 'Retiro rechazado',
            data: {
                withdrawal
            }
        });

    } catch (error) {
        console.error('Error rechazando retiro:', error);

        if (error.message.includes('no encontrado') ||
            error.message.includes('No se puede')) {
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

module.exports = {
    createDraw,
    enterResults,
    listDraws,
    getDrawStats,
    openDraw,
    closeDraw,
    listUsers,
    getUserById,
    adjustBalance,
    listBets,
    getStatistics,
    listWithdrawals,
    approveWithdrawal,
    rejectWithdrawal
};
