const express = require('express');
const router = express.Router();
const auditService = require('../services/auditService');
const { requireAdmin } = require('../middleware/adminAuth');

// =================================
// RUTAS DE AUDITORIA
// =================================

router.use(requireAdmin);

/**
 * GET /api/admin/audit/report
 * Obtener reporte de auditoria completo
 * Query params: date_from, date_to
 */
router.get('/report', async (req, res) => {
    try {
        const { date_from, date_to } = req.query;

        const dateFrom = date_from ? new Date(date_from) : null;
        const dateTo = date_to ? new Date(date_to) : null;

        const report = await auditService.getAuditReport(dateFrom, dateTo);

        res.json({
            success: true,
            data: report
        });
    } catch (error) {
        console.error('Error obteniendo reporte de auditoria:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener reporte de auditoria'
        });
    }
});

/**
 * GET /api/admin/audit/income-expenses
 * Obtener desglose de ingresos vs egresos
 * Query params: date_from, date_to
 */
router.get('/income-expenses', async (req, res) => {
    try {
        const { date_from, date_to } = req.query;

        const dateFrom = date_from ? new Date(date_from) : null;
        const dateTo = date_to ? new Date(date_to) : null;

        const breakdown = await auditService.getIncomeExpensesBreakdown(dateFrom, dateTo);

        res.json({
            success: true,
            data: breakdown
        });
    } catch (error) {
        console.error('Error obteniendo desglose:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener desglose de ingresos/egresos'
        });
    }
});

/**
 * GET /api/admin/audit/balance
 * Obtener balance general del sistema
 */
router.get('/balance', async (req, res) => {
    try {
        const balance = await auditService.getGeneralBalance();

        res.json({
            success: true,
            data: balance
        });
    } catch (error) {
        console.error('Error obteniendo balance general:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener balance general'
        });
    }
});

/**
 * GET /api/admin/audit/fees
 * Obtener reporte de fees del operador
 * Query params: date_from, date_to
 */
router.get('/fees', async (req, res) => {
    try {
        const { date_from, date_to } = req.query;

        const dateFrom = date_from ? new Date(date_from) : null;
        const dateTo = date_to ? new Date(date_to) : null;

        const feesReport = await auditService.getOperatorFeesReport(dateFrom, dateTo);

        res.json({
            success: true,
            data: feesReport
        });
    } catch (error) {
        console.error('Error obteniendo reporte de fees:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener reporte de fees'
        });
    }
});

/**
 * GET /api/admin/audit/transactions
 * Obtener transacciones para auditoria
 * Query params: page, limit, type, date_from, date_to
 */
router.get('/transactions', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 100,
            type,
            date_from,
            date_to
        } = req.query;

        const result = await auditService.getAuditTransactions({
            page: parseInt(page),
            limit: parseInt(limit),
            type,
            dateFrom: date_from ? new Date(date_from) : null,
            dateTo: date_to ? new Date(date_to) : null
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error obteniendo transacciones de auditoria:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener transacciones'
        });
    }
});

/**
 * GET /api/admin/audit/export
 * Exportar reporte de auditoria
 * Query params: date_from, date_to, format (summary|detailed)
 */
router.get('/export', async (req, res) => {
    try {
        const { date_from, date_to, format = 'detailed' } = req.query;

        const dateFrom = date_from ? new Date(date_from) : null;
        const dateTo = date_to ? new Date(date_to) : null;

        const exportData = await auditService.exportAuditReport(dateFrom, dateTo, format);

        res.json({
            success: true,
            data: {
                ...exportData,
                filename: `audit_report_${format}_${new Date().toISOString().split('T')[0]}.csv`
            }
        });
    } catch (error) {
        console.error('Error exportando auditoria:', error);
        res.status(500).json({
            success: false,
            message: 'Error al exportar reporte'
        });
    }
});

module.exports = router;
