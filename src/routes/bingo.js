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
const bingoScheduler = process.env.BINGO_CONTRACT_ADDRESS
  ? require('../services/bingoSchedulerOnChain')
  : require('../services/bingoScheduler');
const { authenticateWallet } = require('../middleware/web3Auth');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { requireFlag } = require('../middleware/featureFlag');

// Rate limiting for public endpoints — generous for polling-heavy game UIs
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
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
 * GET /api/bingo/rooms
 * Returns the 4 rooms with current state, phase, countdown, etc.
 */
router.get('/rooms', publicLimiter, async (req, res) => {
  try {
    const activeRooms = await bingoService.getActiveRooms();
    const schedulerStates = bingoScheduler.getRoomStates();
    const jackpot = await bingoService.getJackpotBalance();
    const config = await bingoService.getConfig();

    // Get player counts for active rounds
    const roundIds = activeRooms.map(r => r.round_id).filter(Boolean);
    const playerCounts = await bingoService.getPlayerCounts(roundIds);

    const rooms = [];
    for (let roomNumber = 1; roomNumber <= 4; roomNumber++) {
      const dbRoom = activeRooms.find(r => r.room_number === roomNumber);
      const schedState = schedulerStates[roomNumber] || {};

      let phase = schedState.phase || 'waiting';
      let currentRoundId = null;
      let status = null;
      let scheduledClose = null;
      let totalCards = 0;
      let drawnBalls = null;
      let drawStartedAt = null;

      if (dbRoom) {
        currentRoundId = dbRoom.round_id;
        status = dbRoom.status;
        scheduledClose = dbRoom.scheduled_close;
        totalCards = dbRoom.total_cards || 0;
        drawnBalls = dbRoom.drawn_balls;
        drawStartedAt = dbRoom.draw_started_at;

        // Derive phase from DB status if scheduler state is stale
        if (dbRoom.status === 'open') phase = 'buying';
        else if (dbRoom.status === 'closed') phase = 'resolving';
        else if (dbRoom.status === 'drawing') phase = 'drawing';
        else if (dbRoom.status === 'resolved') phase = 'results';
        else if (dbRoom.status === 'cancelled') phase = 'results';
      }

      // Override with scheduler live state if available
      if (schedState.phase && schedState.phase !== 'starting') {
        phase = schedState.phase;
      }

      // Use phaseEndTime from scheduler for countdown
      // For buying phase: scheduledClose from DB is the countdown target
      // For other phases: use scheduler's phaseEndTime
      let phaseEndTime = schedState.phaseEndTime || null;
      if (phase === 'buying' && scheduledClose) {
        phaseEndTime = new Date(scheduledClose).toISOString();
      }

      const totalRevenue = dbRoom ? parseFloat(dbRoom.total_revenue || 0) : 0;
      const playerCount = currentRoundId ? (playerCounts[currentRoundId] || 0) : 0;

      rooms.push({
        roomNumber,
        currentRoundId,
        status,
        phase,
        scheduledClose,
        phaseEndTime,
        totalCards,
        totalRevenue,
        playerCount,
        drawStartedAt: phase === 'drawing' ? drawStartedAt : null,
        drawnBalls: phase === 'drawing' ? drawnBalls : null,
        cardPrice: config.cardPrice || 1,
        jackpot,
        // Prize distribution config (for frontend prize estimation)
        feeBps: config.feeBps || 1000,
        reserveBps: config.reserveBps || 1000,
        linePrizeBps: config.linePrizeBps || 1500,
        bingoPrizeBps: config.bingoPrizeBps || 8500,
      });
    }

    res.json({ success: true, data: { rooms, jackpot } });
  } catch (err) {
    console.error('[Bingo] Error getting rooms:', err);
    res.status(500).json({ success: false, message: 'Error al obtener salas' });
  }
});

/**
 * GET /api/bingo/rounds
 * List rounds. ?status=open|resolved|recent&limit=20&room=N
 */
router.get('/rounds', publicLimiter, async (req, res) => {
  try {
    const { status, limit, room } = req.query;
    const rounds = await bingoService.getRounds(status, limit, room);
    res.json({ success: true, data: rounds });
  } catch (err) {
    console.error('[Bingo] Error getting rounds:', err);
    res.status(500).json({ success: false, message: 'Error al obtener rondas' });
  }
});

/**
 * GET /api/bingo/rounds/:id
 * Round detail
 *
 * During status='drawing' winner identities and prizes are redacted to prevent
 * clients from spoiling the synchronized live animation. The ball positions
 * (line_winner_ball, bingo_winner_ball) are preserved because the frontend
 * needs them to time the animation pauses without revealing who won.
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

    if (detail.round && detail.round.status === 'drawing') {
      // Compute winner ball positions from cards BEFORE redacting —
      // the frontend needs these numbers to time animation pauses.
      const cards = detail.cards || [];
      const lineWinnerBall = cards.reduce(
        (min, c) => (c.is_line_winner && c.line_hit_ball > 0 ? Math.min(min, c.line_hit_ball) : min),
        Infinity
      );
      const bingoWinnerBall = cards.reduce(
        (min, c) => (c.is_bingo_winner && c.bingo_hit_ball > 0 ? Math.min(min, c.bingo_hit_ball) : min),
        Infinity
      );

      // Strip winner identity fields only — prize amounts are NOT spoilers
      // (they don't reveal who won), so they're kept so the UI can display
      // the prize during LINE_ANNOUNCED / BINGO_ANNOUNCED overlays.
      const REDACT_ROUND = [
        'line_winner', 'bingo_winner', // identity — redacted until resolved
        'vrf_random_word',             // VRF entropy — always redacted
      ];
      const sanitizedRound = { ...detail.round };
      REDACT_ROUND.forEach(f => { sanitizedRound[f] = null; });
      sanitizedRound.line_winner_ball  = isFinite(lineWinnerBall)  ? lineWinnerBall  : 0;
      sanitizedRound.bingo_winner_ball = isFinite(bingoWinnerBall) ? bingoWinnerBall : 0;

      // Strip per-card winner flags (who won) but keep other card data
      const sanitizedCards = cards.map(({ is_line_winner, is_bingo_winner, line_hit_ball, bingo_hit_ball, ...rest }) => rest); // eslint-disable-line no-unused-vars

      return res.json({
        success: true,
        data: { round: sanitizedRound, cards: sanitizedCards, results: null },
      });
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
 *
 * Intentionally not available during status='drawing' — exposing the VRF seed
 * and winner card IDs before the animation finishes would allow clients to
 * determine results ahead of the synchronized draw.
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

    // Block verification data while the live animation is running
    if (data.status === 'drawing') {
      return res.json({
        success: true,
        data: {
          roundId: data.roundId,
          status: 'drawing',
          message: 'Verification data available after the draw completes.',
        },
      });
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
 * GET /api/bingo/my-rooms
 * Returns rooms where user has active cards (non-cancelled rounds)
 */
router.get('/my-rooms', requireFlag('bingo_enabled'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;
    const cards = await bingoService.getUserActiveRooms(walletAddress);
    res.json({ success: true, data: cards });
  } catch (err) {
    console.error('[Bingo] Error getting user active rooms:', err);
    res.status(500).json({ success: false, message: 'Error al obtener salas activas' });
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
