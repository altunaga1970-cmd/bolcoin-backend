const express = require('express');
const router = express.Router();
const drawController = require('../controllers/drawController');
const { optionalAuth } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');

// =================================
// RUTAS DE SORTEOS
// =================================

/**
 * GET /api/draws/active
 * Obtener sorteos activos (abiertos para apuestas)
 * Público (no requiere autenticación)
 */
router.get('/active', optionalAuth, drawController.getActive);

/**
 * GET /api/draws/upcoming
 * Obtener próximos sorteos
 * Query params: limit (default: 5)
 * Público
 */
router.get('/upcoming', optionalAuth, drawController.getUpcoming);

/**
 * GET /api/draws/completed
 * Obtener sorteos completados con resultados
 * Query params: page, limit
 * Público
 */
router.get('/completed', [optionalAuth, validatePagination], drawController.getCompleted);

/**
 * GET /api/draws/:id
 * Obtener sorteo específico por ID
 * Público
 */
router.get('/:id', optionalAuth, drawController.getById);

/**
 * GET /api/draws/:id/results
 * Obtener resultados de un sorteo
 * Público
 */
router.get('/:id/results', optionalAuth, drawController.getResults);

module.exports = router;
