const express = require('express');
const router = express.Router();
const lotteryController = require('../controllers/lotteryController');
const { authenticateWallet } = require('../middleware/web3Auth');
const { optionalAuth } = require('../middleware/auth');
const { requireFlag } = require('../middleware/featureFlag');

// =================================
// LOTTERY ROUTES - La Fortuna
// Protegidas por feature flag 'game_fortuna'
// =================================

// Aplicar feature flag a TODAS las rutas de lottery
router.use(requireFlag('game_fortuna'));

/**
 * GET /api/lottery/info
 * Get lottery info (next draw, jackpot, prices)
 * Public
 */
router.get('/info', optionalAuth, lotteryController.getLotteryInfo);

/**
 * GET /api/lottery/jackpot
 * Get current jackpot amount
 * Public
 */
router.get('/jackpot', optionalAuth, lotteryController.getJackpot);

/**
 * POST /api/lottery/tickets
 * Purchase lottery tickets
 * Requires wallet authentication
 */
router.post('/tickets', authenticateWallet, lotteryController.purchaseTickets);

/**
 * GET /api/lottery/my-tickets
 * Get user's lottery tickets
 * Requires wallet authentication
 */
router.get('/my-tickets', authenticateWallet, lotteryController.getMyTickets);

module.exports = router;
