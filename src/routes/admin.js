const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
    validateCreateDraw,
    validateEnterResults,
    validateUserId,
    validateAdjustBalance,
    validatePagination
} = require('../middleware/validation');

// =================================
// RUTAS DE ADMINISTRACIÓN
// =================================

// Todas las rutas requieren autenticación y rol de admin
router.use(authenticate);
router.use(requireAdmin);

// ====================
// GESTIÓN DE SORTEOS
// ====================

/**
 * POST /api/admin/draws
 * Crear nuevo sorteo
 */
router.post('/draws', validateCreateDraw, adminController.createDraw);

/**
 * GET /api/admin/draws
 * Listar todos los sorteos
 * Query params: page, limit, status
 */
router.get('/draws', validatePagination, adminController.listDraws);

/**
 * PUT /api/admin/draws/:id/results
 * Ingresar número ganador y procesar pagos
 */
router.put('/draws/:id/results', validateEnterResults, adminController.enterResults);

/**
 * GET /api/admin/draws/:id/stats
 * Obtener estadísticas de un sorteo
 */
router.get('/draws/:id/stats', adminController.getDrawStats);

/**
 * PUT /api/admin/draws/:id/open
 * Abrir sorteo para apuestas
 */
router.put('/draws/:id/open', adminController.openDraw);

/**
 * PUT /api/admin/draws/:id/close
 * Cerrar sorteo
 */
router.put('/draws/:id/close', adminController.closeDraw);

// ====================
// GESTIÓN DE USUARIOS
// ====================

/**
 * GET /api/admin/users
 * Listar usuarios
 * Query params: page, limit, search, role
 */
router.get('/users', validatePagination, adminController.listUsers);

/**
 * GET /api/admin/users/:id
 * Obtener usuario específico
 */
router.get('/users/:id', validateUserId, adminController.getUserById);

/**
 * PUT /api/admin/users/:id/balance
 * Ajustar balance de usuario
 */
router.put('/users/:id/balance', validateAdjustBalance, adminController.adjustBalance);

// ====================
// GESTIÓN DE APUESTAS
// ====================

/**
 * GET /api/admin/bets
 * Listar apuestas
 * Query params: page, limit, userId, drawId, status
 */
router.get('/bets', validatePagination, adminController.listBets);

// ====================
// GESTIÓN DE RETIROS
// ====================

/**
 * GET /api/admin/withdrawals
 * Listar retiros pendientes de aprobación
 * Query params: page, limit, status
 */
router.get('/withdrawals', validatePagination, adminController.listWithdrawals);

/**
 * PUT /api/admin/withdrawals/:id/approve
 * Aprobar un retiro
 */
router.put('/withdrawals/:id/approve', adminController.approveWithdrawal);

/**
 * PUT /api/admin/withdrawals/:id/reject
 * Rechazar un retiro
 */
router.put('/withdrawals/:id/reject', adminController.rejectWithdrawal);

// ====================
// ESTADÍSTICAS
// ====================

/**
 * GET /api/admin/statistics
 * Obtener estadísticas del sistema
 */
router.get('/statistics', adminController.getStatistics);

module.exports = router;
