const express = require('express');
const router = express.Router();
const referralAdminService = require('../services/referralAdminService');
const { requireAdmin } = require('../middleware/adminAuth');

// =================================
// RUTAS DE REFERIDOS ADMIN
// =================================

router.use(requireAdmin);

/**
 * GET /api/admin/referrals/stats
 * Obtener estadisticas generales de referidos
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await referralAdminService.getReferralStats();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error obteniendo estadisticas de referidos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener estadisticas'
        });
    }
});

/**
 * GET /api/admin/referrals/list
 * Listar todos los referidos
 * Query params: page, limit, status, search
 */
router.get('/list', async (req, res) => {
    try {
        const { page = 1, limit = 50, status, search } = req.query;

        const result = await referralAdminService.listReferrals({
            page: parseInt(page),
            limit: parseInt(limit),
            status,
            search
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error listando referidos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar referidos'
        });
    }
});

/**
 * GET /api/admin/referrals/commissions
 * Listar comisiones
 * Query params: page, limit, status, referrer_wallet, date_from, date_to
 */
router.get('/commissions', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            status,
            referrer_wallet,
            date_from,
            date_to
        } = req.query;

        const result = await referralAdminService.listCommissions({
            page: parseInt(page),
            limit: parseInt(limit),
            status,
            referrerWallet: referrer_wallet,
            dateFrom: date_from ? new Date(date_from) : null,
            dateTo: date_to ? new Date(date_to) : null
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error listando comisiones:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar comisiones'
        });
    }
});

/**
 * GET /api/admin/referrals/totals
 * Obtener totales para auditoria
 */
router.get('/totals', async (req, res) => {
    try {
        const totals = await referralAdminService.getReferralTotals();

        res.json({
            success: true,
            data: totals
        });
    } catch (error) {
        console.error('Error obteniendo totales:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener totales'
        });
    }
});

/**
 * PUT /api/admin/referrals/:id/status
 * Cambiar estado de un referido
 */
router.put('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Estado requerido'
            });
        }

        const referral = await referralAdminService.updateReferralStatus(parseInt(id), status);

        res.json({
            success: true,
            data: referral,
            message: 'Estado actualizado'
        });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Error al actualizar estado'
        });
    }
});

/**
 * POST /api/admin/referrals/commissions/pay
 * Marcar comisiones como pagadas
 */
router.post('/commissions/pay', async (req, res) => {
    try {
        const { commission_ids } = req.body;

        if (!commission_ids || !Array.isArray(commission_ids) || commission_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'IDs de comisiones requeridos'
            });
        }

        const result = await referralAdminService.markCommissionsAsPaid(
            commission_ids,
            req.user.id
        );

        res.json({
            success: true,
            data: result,
            message: `${result.updated} comisiones marcadas como pagadas`
        });
    } catch (error) {
        console.error('Error pagando comisiones:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar pago de comisiones'
        });
    }
});

/**
 * GET /api/admin/referrals/export
 * Exportar datos de referidos
 */
router.get('/export', async (req, res) => {
    try {
        const { type = 'referrals' } = req.query;

        let headers;
        let rows;

        if (type === 'commissions') {
            const result = await referralAdminService.listCommissions({
                page: 1,
                limit: 10000
            });

            headers = ['ID', 'Referidor', 'Referido', 'ID Apuesta', 'Monto Apuesta', 'Tasa', 'Comision', 'Estado', 'Fecha Pago', 'Creado'];
            rows = result.commissions.map(c => [
                c.id,
                c.referrer_wallet,
                c.referred_wallet,
                c.bet_id,
                c.bet_amount,
                c.commission_rate,
                c.commission_amount,
                c.status,
                c.paid_at,
                c.created_at
            ]);
        } else {
            const result = await referralAdminService.listReferrals({
                page: 1,
                limit: 10000
            });

            headers = ['ID', 'Referidor', 'Codigo', 'Referido', 'Metodo', 'Total Apuestas', 'Total Comisiones', 'Estado', 'Registrado'];
            rows = result.referrals.map(r => [
                r.id,
                r.referrer_wallet,
                r.referral_code,
                r.referred_wallet,
                r.registration_method,
                r.total_bets_amount,
                r.total_commissions_generated,
                r.status,
                r.registered_at
            ]);
        }

        res.json({
            success: true,
            data: {
                headers,
                rows,
                filename: `referrals_${type}_${new Date().toISOString().split('T')[0]}.csv`
            }
        });
    } catch (error) {
        console.error('Error exportando referidos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al exportar datos'
        });
    }
});

module.exports = router;
