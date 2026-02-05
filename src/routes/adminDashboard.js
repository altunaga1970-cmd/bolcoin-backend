const express = require('express');
const router = express.Router();
const metricsService = require('../services/metricsService');
const { requireAdminSession } = require('../middleware/siweAuth');

// =================================
// RUTAS DE DASHBOARD FINANCIERO
// =================================

// Todas las rutas requieren sesion de admin (SIWE)
router.use(requireAdminSession);

/**
 * GET /api/admin/dashboard/metrics
 * Obtener metricas segun periodo
 * Query params: period (daily|monthly|yearly), date_from, date_to
 */
router.get('/metrics', async (req, res) => {
    try {
        const { period = 'daily', date_from, date_to } = req.query;

        const dateFrom = date_from ? new Date(date_from) : null;
        const dateTo = date_to ? new Date(date_to) : null;

        const metrics = await metricsService.getDashboardMetrics(period, dateFrom, dateTo);

        res.json({
            success: true,
            data: metrics
        });
    } catch (error) {
        console.error('Error obteniendo metricas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener metricas'
        });
    }
});

/**
 * GET /api/admin/dashboard/summary
 * Obtener resumen del dashboard
 */
router.get('/summary', async (req, res) => {
    try {
        const summary = await metricsService.getDashboardSummary();

        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error('Error obteniendo resumen:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener resumen del dashboard'
        });
    }
});

/**
 * GET /api/admin/dashboard/chart-data
 * Obtener datos para graficos
 * Query params: period (daily|monthly), days
 */
router.get('/chart-data', async (req, res) => {
    try {
        const { period = 'daily', days = 30 } = req.query;

        const chartData = await metricsService.getChartData(period, parseInt(days));

        res.json({
            success: true,
            data: chartData
        });
    } catch (error) {
        console.error('Error obteniendo datos de grafico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener datos para graficos'
        });
    }
});

/**
 * GET /api/admin/dashboard/realtime
 * Obtener metricas en tiempo real
 */
router.get('/realtime', async (req, res) => {
    try {
        const realtime = await metricsService.getRealTimeMetrics();

        res.json({
            success: true,
            data: realtime
        });
    } catch (error) {
        console.error('Error obteniendo metricas en tiempo real:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener metricas en tiempo real'
        });
    }
});

/**
 * POST /api/admin/dashboard/aggregate
 * Forzar agregacion de metricas para hoy
 */
router.post('/aggregate', async (req, res) => {
    try {
        await metricsService.aggregateTodayMetrics();

        res.json({
            success: true,
            message: 'Metricas agregadas correctamente'
        });
    } catch (error) {
        console.error('Error agregando metricas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al agregar metricas'
        });
    }
});

module.exports = router;
