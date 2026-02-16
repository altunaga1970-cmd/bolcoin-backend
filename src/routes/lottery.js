const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const lotteryController = require('../controllers/lotteryController');
const { authenticateWallet } = require('../middleware/web3Auth');
const { optionalAuth } = require('../middleware/auth');
const { requireFlag } = require('../middleware/featureFlag');
const { requireAdmin } = require('../middleware/adminAuth');

// =================================
// LOTTERY ROUTES - La Fortuna
// Protegidas por feature flag 'game_fortuna'
// =================================

// Rate limiter for ticket purchases: max 5 per minute per IP
const ticketLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, message: 'Demasiadas compras. Intenta en 1 minuto.' },
    standardHeaders: true,
    legacyHeaders: false
});

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
 * Requires wallet authentication + rate limiting
 */
router.post('/tickets', ticketLimiter, authenticateWallet, lotteryController.purchaseTickets);

/**
 * GET /api/lottery/my-tickets
 * Get user's lottery tickets
 * Requires wallet authentication
 */
router.get('/my-tickets', authenticateWallet, lotteryController.getMyTickets);

// =================================
// ADMIN ROUTES - Lottery Settlement
// =================================

/**
 * PUT /api/lottery/admin/draws/:id/results
 * Set winning numbers for a lottery draw and trigger settlement
 * Requires admin auth
 * Body: { numbers: [1,2,3,4,5,6], keyNumber: 5 }
 */
router.put('/admin/draws/:id/results', requireAdmin, lotteryController.setDrawResults);

/**
 * GET /api/lottery/admin/draws/:id/winners
 * Get winners for a completed lottery draw
 * Requires admin auth
 */
router.get('/admin/draws/:id/winners', requireAdmin, lotteryController.getDrawWinners);

/**
 * GET /api/lottery/admin/draws
 * List all lottery draws (admin view)
 * Requires admin auth
 */
router.get('/admin/draws', requireAdmin, lotteryController.listLotteryDraws);

module.exports = router;
