const express = require('express');
const router = express.Router();
const betController = require('../controllers/betController');
const { authenticateWallet } = require('../middleware/web3Auth');
const { validatePlaceBet, validatePagination } = require('../middleware/validation');
const { requireFlag } = require('../middleware/featureFlag');

// =================================
// RUTAS DE APUESTAS (La Bolita)
// Protegidas por feature flag 'game_bolita'
// =================================

// Todas las rutas requieren autenticacion de wallet + feature flag
router.use(requireFlag('game_bolita'));
router.use(authenticateWallet);

/**
 * POST /api/bets/place
 * Realizar apuestas
 * Body: { draw_id, bets: [{ game_type, number, amount }] }
 */
router.post('/place', validatePlaceBet, betController.placeBets);

/**
 * GET /api/bets/my-bets
 * Obtener apuestas del usuario
 * Query params: page, limit, status, draw_id
 */
router.get('/my-bets', validatePagination, betController.getMyBets);

/**
 * GET /api/bets/stats
 * Obtener estadísticas de apuestas del usuario
 */
router.get('/stats', betController.getBetStats);

/**
 * GET /api/bets/:id
 * Obtener apuesta específica por ID
 */
router.get('/:id', betController.getBetById);

module.exports = router;
