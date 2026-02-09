const express = require('express');
const router = express.Router();
const scheduler = require('../scheduler');
const AuditLog = require('../models/AuditLog');
const { requireAdmin } = require('../middleware/adminAuth');

// =================================
// RUTAS DE SCHEDULER Y AUDIT LOGS
// =================================

/**
 * GET /api/scheduler/status
 * Obtener estado del scheduler
 */
router.get('/status', requireAdmin, (req, res) => {
    const status = scheduler.getStatus();
    res.json({
        success: true,
        data: status
    });
});

/**
 * POST /api/scheduler/start
 * Iniciar scheduler
 */
router.post('/start', requireAdmin, async (req, res) => {
    try {
        await scheduler.start();
        res.json({
            success: true,
            message: 'Scheduler iniciado'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * POST /api/scheduler/stop
 * Detener scheduler
 */
router.post('/stop', requireAdmin, async (req, res) => {
    try {
        await scheduler.stop();
        res.json({
            success: true,
            message: 'Scheduler detenido'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * POST /api/scheduler/run-checks
 * Ejecutar verificaciones manualmente
 */
router.post('/run-checks', requireAdmin, async (req, res) => {
    try {
        await scheduler.runAllChecks();
        res.json({
            success: true,
            message: 'Verificaciones ejecutadas'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// =================================
// RUTAS DE AUDIT LOGS
// =================================

/**
 * GET /api/audit-logs
 * Obtener logs de auditoría
 */
router.get('/audit-logs', requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, action, entityType } = req.query;

        const result = await AuditLog.findRecent({
            page: parseInt(page),
            limit: parseInt(limit),
            action,
            entityType
        });

        res.json({
            success: true,
            data: result.logs,
            pagination: result.pagination
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /api/audit-logs/draw/:drawId
 * Obtener logs de un sorteo específico
 */
router.get('/audit-logs/draw/:drawId', requireAdmin, async (req, res) => {
    try {
        const { drawId } = req.params;
        const logs = await AuditLog.findByEntity('draw', drawId);

        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
