const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const bankrollService = require('../services/bankrollService');

// =================================
// RUTAS PÚBLICAS (para usuarios)
// =================================

/**
 * GET /api/bankroll/status
 * Obtener estado público del sistema (límite actual)
 */
router.get('/status', async (req, res) => {
    try {
        const status = await bankrollService.getBankrollStatus();

        res.json({
            success: true,
            data: {
                current_limit_per_number: parseFloat(status.current_limit_per_number),
                min_limit: parseFloat(status.min_limit_per_number),
                max_limit: parseFloat(status.max_limit_per_number)
            }
        });
    } catch (error) {
        console.error('Error obteniendo estado del bankroll:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estado del sistema'
        });
    }
});

/**
 * GET /api/bankroll/check-number/:drawId/:gameType/:number
 * Verificar disponibilidad de un número
 */
router.get('/check-number/:drawId/:gameType/:number', async (req, res) => {
    try {
        const { drawId, gameType, number } = req.params;
        const amount = parseFloat(req.query.amount) || 1;

        const availability = await bankrollService.checkNumberAvailability(
            parseInt(drawId),
            gameType,
            number,
            amount
        );

        res.json({
            success: true,
            data: availability
        });
    } catch (error) {
        console.error('Error verificando número:', error);
        res.status(500).json({
            success: false,
            message: 'Error verificando disponibilidad'
        });
    }
});

/**
 * GET /api/bankroll/sold-out/:drawId
 * Obtener números vendidos de un sorteo
 */
router.get('/sold-out/:drawId', async (req, res) => {
    try {
        const { drawId } = req.params;
        const soldOut = await bankrollService.getSoldOutNumbers(parseInt(drawId));

        res.json({
            success: true,
            data: {
                draw_id: parseInt(drawId),
                sold_out_numbers: soldOut,
                count: soldOut.length
            }
        });
    } catch (error) {
        console.error('Error obteniendo números vendidos:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo números vendidos'
        });
    }
});

/**
 * GET /api/bankroll/exposure/:drawId
 * Obtener exposición total de un sorteo
 */
router.get('/exposure/:drawId', async (req, res) => {
    try {
        const { drawId } = req.params;
        const exposure = await bankrollService.getDrawExposure(parseInt(drawId));

        res.json({
            success: true,
            data: {
                draw_id: parseInt(drawId),
                exposure
            }
        });
    } catch (error) {
        console.error('Error obteniendo exposición:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo exposición'
        });
    }
});

// =================================
// RUTAS ADMIN (requieren autenticación)
// =================================

/**
 * GET /api/bankroll/admin/full-status
 * Obtener estado completo del sistema (solo admin)
 */
router.get('/admin/full-status', authenticate, requireAdmin, async (req, res) => {
    try {
        const status = await bankrollService.getBankrollStatus();

        res.json({
            success: true,
            data: {
                bankroll_balance: parseFloat(status.bankroll_balance),
                prize_reserve: parseFloat(status.prize_reserve),
                current_limit_per_number: parseFloat(status.current_limit_per_number),
                min_limit_per_number: parseFloat(status.min_limit_per_number),
                max_limit_per_number: parseFloat(status.max_limit_per_number),
                total_bets_processed: parseFloat(status.total_bets_processed),
                total_prizes_paid: parseFloat(status.total_prizes_paid),
                total_fees_collected: parseFloat(status.total_fees_collected),
                last_limit_update: status.last_limit_update,
                created_at: status.created_at,
                updated_at: status.updated_at
            }
        });
    } catch (error) {
        console.error('Error obteniendo estado completo:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estado del sistema'
        });
    }
});

/**
 * GET /api/bankroll/admin/settlements
 * Obtener historial de liquidaciones
 */
router.get('/admin/settlements', authenticate, requireAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const settlements = await bankrollService.getSettlementHistory(limit);

        res.json({
            success: true,
            data: settlements
        });
    } catch (error) {
        console.error('Error obteniendo liquidaciones:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo historial de liquidaciones'
        });
    }
});

/**
 * POST /api/bankroll/admin/initialize
 * Inicializar capital del sistema (solo una vez)
 */
router.post('/admin/initialize', authenticate, requireAdmin, async (req, res) => {
    try {
        const { initial_reserve } = req.body;

        if (!initial_reserve || initial_reserve < 100) {
            return res.status(400).json({
                success: false,
                message: 'Reserva inicial debe ser al menos 100 USDT'
            });
        }

        const result = await bankrollService.initializeCapital(parseFloat(initial_reserve));

        res.json({
            success: true,
            message: 'Sistema inicializado correctamente',
            data: result
        });
    } catch (error) {
        console.error('Error inicializando capital:', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * POST /api/bankroll/admin/adjust
 * Ajustar capital manualmente
 */
router.post('/admin/adjust', authenticate, requireAdmin, async (req, res) => {
    try {
        const { target_fund, amount, reason } = req.body;

        if (!target_fund || !['reserve', 'bankroll'].includes(target_fund)) {
            return res.status(400).json({
                success: false,
                message: 'target_fund debe ser "reserve" o "bankroll"'
            });
        }

        if (!amount || typeof amount !== 'number') {
            return res.status(400).json({
                success: false,
                message: 'amount debe ser un número'
            });
        }

        const result = await bankrollService.adjustCapital(
            target_fund,
            parseFloat(amount),
            reason,
            req.user.id
        );

        res.json({
            success: true,
            message: 'Ajuste realizado correctamente',
            data: result
        });
    } catch (error) {
        console.error('Error ajustando capital:', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
