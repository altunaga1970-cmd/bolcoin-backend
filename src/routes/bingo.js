/**
 * Bingo Routes
 *
 * Endpoints for the Bingo game.
 * Public, protected (wallet auth + feature flag), and admin routes.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const bingoService = require('../services/bingoService');
const { authenticateWallet } = require('../middleware/web3Auth');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { requireFlag } = require('../middleware/featureFlag');

// Rate limiting for public endpoints
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { success: false, message: 'Demasiadas peticiones. Espera un momento.' }
});

// =================================
// PUBLIC ROUTES
// =================================

/**
 * GET /api/bingo/config
 * Game config + jackpot balance
 */
router.get('/config', publicLimiter, async (req, res) => {
  try {
    const config = await bingoService.getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    console.error('[Bingo] Error getting config:', err);
    res.status(500).json({ success: false, message: 'Error al obtener configuracion' });
  }
});

/**
 * GET /api/bingo/rounds
 * List rounds. ?status=open|resolved|recent&limit=20
 */
router.get('/rounds', publicLimiter, async (req, res) => {
  try {
    const { status, limit } = req.query;
    const rounds = await bingoService.getRounds(status, limit);
    res.json({ success: true, data: rounds });
  } catch (err) {
    console.error('[Bingo] Error getting rounds:', err);
    res.status(500).json({ success: false, message: 'Error al obtener rondas' });
  }
});

/**
 * GET /api/bingo/rounds/:id
 * Round detail
 */
router.get('/rounds/:id', publicLimiter, async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    if (isNaN(roundId)) {
      return res.status(400).json({ success: false, message: 'ID de ronda invalido' });
    }
    const detail = await bingoService.getRoundDetail(roundId);
    if (!detail) {
      return res.status(404).json({ success: false, message: 'Ronda no encontrada' });
    }
    res.json({ success: true, data: detail });
  } catch (err) {
    console.error('[Bingo] Error getting round detail:', err);
    res.status(500).json({ success: false, message: 'Error al obtener detalle de ronda' });
  }
});

/**
 * GET /api/bingo/verify/:roundId
 * Public verification data
 */
router.get('/verify/:roundId', publicLimiter, async (req, res) => {
  try {
    const roundId = parseInt(req.params.roundId);
    if (isNaN(roundId)) {
      return res.status(400).json({ success: false, message: 'ID de ronda invalido' });
    }
    const data = await bingoService.getVerificationData(roundId);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Ronda no encontrada' });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Bingo] Error getting verification data:', err);
    res.status(500).json({ success: false, message: 'Error al obtener datos de verificacion' });
  }
});

// =================================
// PROTECTED ROUTES (wallet auth + feature flag)
// =================================

/**
 * POST /api/bingo/buy-cards
 * Off-chain card purchase. Body: { roundId, count: 1-4 }
 */
router.post('/buy-cards', requireFlag('bingo_enabled'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;
    const { roundId, count } = req.body;

    if (!roundId || isNaN(parseInt(roundId))) {
      return res.status(400).json({ success: false, message: 'roundId requerido' });
    }
    const cardCount = Math.min(Math.max(parseInt(count) || 1, 1), 4);

    const cards = await bingoService.buyCardsOffChain(walletAddress, parseInt(roundId), cardCount);
    res.json({ success: true, data: cards });
  } catch (err) {
    console.error('[Bingo] Error buying cards:', err);
    const status = err.message.includes('Insufficient') ? 402 : 400;
    res.status(status).json({ success: false, message: err.message || 'Error al comprar cartas' });
  }
});

/**
 * GET /api/bingo/my-cards
 * User's cards. ?roundId=X (optional)
 */
router.get('/my-cards', requireFlag('bingo_enabled'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;
    const { roundId } = req.query;
    const cards = await bingoService.getUserCards(walletAddress, roundId);
    res.json({ success: true, data: cards });
  } catch (err) {
    console.error('[Bingo] Error getting user cards:', err);
    res.status(500).json({ success: false, message: 'Error al obtener cartas' });
  }
});

/**
 * GET /api/bingo/history
 * User's past rounds. ?limit=20
 */
router.get('/history', requireFlag('bingo_enabled'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;
    const { limit } = req.query;
    const history = await bingoService.getUserHistory(walletAddress, limit);
    res.json({ success: true, data: history });
  } catch (err) {
    console.error('[Bingo] Error getting user history:', err);
    res.status(500).json({ success: false, message: 'Error al obtener historial' });
  }
});

// =================================
// ADMIN ROUTES
// =================================

/**
 * POST /api/bingo/admin/create-round
 * Create a new round. Body: { scheduledClose: unix_timestamp }
 */
router.post('/admin/create-round', authenticate, requireAdmin, async (req, res) => {
  try {
    const { scheduledClose } = req.body;
    if (!scheduledClose || isNaN(parseInt(scheduledClose))) {
      return res.status(400).json({ success: false, message: 'scheduledClose (unix timestamp) requerido' });
    }
    const result = await bingoService.createRound(parseInt(scheduledClose));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Bingo] Error creating round:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al crear ronda' });
  }
});

/**
 * POST /api/bingo/admin/close-round
 * Close a round and request VRF. Body: { roundId }
 */
router.post('/admin/close-round', authenticate, requireAdmin, async (req, res) => {
  try {
    const { roundId } = req.body;
    if (!roundId || isNaN(parseInt(roundId))) {
      return res.status(400).json({ success: false, message: 'roundId requerido' });
    }
    const result = await bingoService.closeRound(parseInt(roundId));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Bingo] Error closing round:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al cerrar ronda' });
  }
});

/**
 * POST /api/bingo/admin/cancel-round
 * Cancel a round. Body: { roundId }
 */
router.post('/admin/cancel-round', authenticate, requireAdmin, async (req, res) => {
  try {
    const { roundId } = req.body;
    if (!roundId || isNaN(parseInt(roundId))) {
      return res.status(400).json({ success: false, message: 'roundId requerido' });
    }
    const result = await bingoService.cancelRound(parseInt(roundId));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Bingo] Error cancelling round:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al cancelar ronda' });
  }
});

/**
 * GET /api/bingo/admin/stats
 * Admin stats. ?date_from&date_to
 */
router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const stats = await bingoService.getAdminStats(date_from, date_to);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('[Bingo] Error getting admin stats:', err);
    res.status(500).json({ success: false, message: 'Error al obtener estadisticas' });
  }
});

module.exports = router;
