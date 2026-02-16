const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const betController = require('../controllers/betController');
const { authenticateWallet } = require('../middleware/web3Auth');
const { validatePlaceBet, validatePagination } = require('../middleware/validation');
const { requireFlag } = require('../middleware/featureFlag');

// =================================
// RUTAS DE APUESTAS (La Bolita)
// Protegidas por feature flag 'game_bolita'
// =================================

// Rate limiter for bet placement: max 10 per minute per wallet
const betPlaceLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user?.address || req.headers['x-wallet-address'] || 'anonymous',
    validate: { xForwardedForHeader: false },
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiadas apuestas. Intenta de nuevo en un minuto.' }
});

// Todas las rutas requieren autenticacion de wallet + feature flag
router.use(requireFlag('game_bolita'));
router.use(authenticateWallet);

/**
 * POST /api/bets/place
 * Realizar apuestas
 * Body: { draw_id, bets: [{ game_type, number, amount }] }
 */
router.post('/place', betPlaceLimiter, validatePlaceBet, betController.placeBets);

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
