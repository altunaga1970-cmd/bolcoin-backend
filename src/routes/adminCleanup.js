const express = require('express');
const router = express.Router();
const dataCleanupService = require('../services/dataCleanupService');
const { requireAdmin } = require('../middleware/adminAuth');

// =================================
// RUTAS DE LIMPIEZA DE DATOS
// =================================

router.use(requireAdmin);

/**
 * GET /api/admin/cleanup/status
 * Obtener estado de limpieza de datos
 */
router.get('/status', async (req, res) => {
    try {
        const status = await dataCleanupService.getCleanupStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Error obteniendo estado de limpieza:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener estado de limpieza'
        });
    }
});

/**
 * GET /api/admin/cleanup/history
 * Obtener historial de limpiezas
 */
router.get('/history', async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const history = await dataCleanupService.getCleanupHistory(parseInt(limit));

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener historial de limpieza'
        });
    }
});

/**
 * POST /api/admin/cleanup/trigger
 * Ejecutar limpieza manualmente
 */
router.post('/trigger', async (req, res) => {
    try {
        const { retention_days = 7 } = req.body;

        // Validar dias de retencion
        if (retention_days < 1 || retention_days > 90) {
            return res.status(400).json({
                success: false,
                message: 'Dias de retencion debe ser entre 1 y 90'
            });
        }

        console.log(`[Cleanup] Limpieza manual iniciada por admin ${req.user.id}`);

        const result = await dataCleanupService.runCleanup(retention_days);

        res.json({
            success: true,
            data: result,
            message: `Limpieza completada. ${result.records_deleted} registros eliminados.`
        });
    } catch (error) {
        console.error('Error ejecutando limpieza:', error);
        res.status(500).json({
            success: false,
            message: 'Error al ejecutar limpieza'
        });
    }
});

/**
 * POST /api/admin/cleanup/aggregate
 * Agregar metricas para un rango de fechas
 */
router.post('/aggregate', async (req, res) => {
    try {
        const { date_from, date_to } = req.body;

        if (!date_from || !date_to) {
            return res.status(400).json({
                success: false,
                message: 'Fechas requeridas (date_from, date_to)'
            });
        }

        const result = await dataCleanupService.aggregateMetricsRange(
            new Date(date_from),
            new Date(date_to)
        );

        res.json({
            success: true,
            data: result,
            message: `Metricas agregadas para ${result.aggregated} dias`
        });
    } catch (error) {
        console.error('Error agregando metricas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al agregar metricas'
        });
    }
});

/**
 * POST /api/admin/cleanup/regenerate-monthly
 * Regenerar metricas mensuales
 */
router.post('/regenerate-monthly', async (req, res) => {
    try {
        const { year, month } = req.body;

        if (!year || !month) {
            return res.status(400).json({
                success: false,
                message: 'Ano y mes requeridos'
            });
        }

        const result = await dataCleanupService.regenerateMonthlyMetrics(
            parseInt(year),
            parseInt(month)
        );

        res.json({
            success: true,
            data: result,
            message: `Metricas de ${month}/${year} regeneradas`
        });
    } catch (error) {
        console.error('Error regenerando metricas mensuales:', error);
        res.status(500).json({
            success: false,
            message: 'Error al regenerar metricas'
        });
    }
});

/**
 * GET /api/admin/cleanup/should-run
 * Verificar si es necesario ejecutar limpieza
 */
router.get('/should-run', async (req, res) => {
    try {
        const shouldRun = await dataCleanupService.shouldRunCleanup();

        res.json({
            success: true,
            data: {
                shouldRun,
                message: shouldRun ? 'Se recomienda ejecutar limpieza' : 'No es necesario ejecutar limpieza'
            }
        });
    } catch (error) {
        console.error('Error verificando limpieza:', error);
        res.status(500).json({
            success: false,
            message: 'Error al verificar estado'
        });
    }
});

module.exports = router;
