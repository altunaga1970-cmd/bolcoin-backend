/**
 * Keno Routes (MVP)
 *
 * Endpoints para el juego de Keno
 * Protegido por feature flag 'game_keno'
 */

const express = require('express');
const router = express.Router();
const kenoService = require('../services/kenoService');
const kenoSessionService = require('../services/kenoSessionService');
const kenoVrfService = require('../services/kenoVrfService');
const kenoPoolHealthService = require('../services/kenoPoolHealthService');
const { authenticateWallet } = require('../middleware/web3Auth');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { requireFlag } = require('../middleware/featureFlag');

// =================================
// RUTAS PUBLICAS
// =================================

/**
 * GET /api/keno/config
 * Obtener configuracion del juego (tabla de pagos, limites, etc)
 * MVP: Incluye betAmount fijo, maxPayout cap, feeBps
 */
router.get('/config', async (req, res) => {
  try {
    const config = await kenoService.getConfig();
    res.json({
      success: true,
      data: config
    });
  } catch (err) {
    console.error('[Keno] Error getting config:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener configuracion'
    });
  }
});

// =================================
// RUTAS PROTEGIDAS (requieren wallet + feature flag)
// =================================

/**
 * GET /api/keno/balance
 * Obtener balance total (contrato + virtual keno)
 */
router.get('/balance', requireFlag('game_keno'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;
    const balances = await kenoService.getTotalBalance(walletAddress);

    res.json({
      success: true,
      data: balances
    });
  } catch (err) {
    console.error('[Keno] Error getting balance:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener balance'
    });
  }
});

/**
 * POST /api/keno/play
 * Jugar una partida de Keno
 *
 * Body: { numbers: [1, 5, 10, ...] }
 * MVP: amount es ignorado (siempre 1 USDT)
 */
router.post('/play', requireFlag('game_keno'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;
    const { numbers, amount } = req.body;

    if (!numbers || !Array.isArray(numbers)) {
      return res.status(400).json({
        success: false,
        message: 'Numeros requeridos (array)'
      });
    }

    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({
        success: false,
        message: 'Monto requerido'
      });
    }

    // Jugar
    const result = await kenoService.playKeno(walletAddress, numbers, amount);

    res.json({
      success: true,
      data: result
    });

  } catch (err) {
    console.error('[Keno] Error playing:', err);
    res.status(400).json({
      success: false,
      message: err.message || 'Error al procesar jugada'
    });
  }
});

/**
 * GET /api/keno/history
 * Obtener historial de partidas del usuario
 */
router.get('/history', requireFlag('game_keno'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;
    const limit = parseInt(req.query.limit) || 20;

    const history = await kenoService.getGameHistory(walletAddress, limit);

    res.json({
      success: true,
      data: history
    });
  } catch (err) {
    console.error('[Keno] Error getting history:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial'
    });
  }
});

// =================================
// RUTAS DE SESION (protegidas por feature flag)
// =================================

/**
 * GET /api/keno/session
 * Obtener informacion de la sesion activa
 */
router.get('/session', requireFlag('game_keno'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;

    const session = await kenoSessionService.getActiveSession(walletAddress);
    const balances = await kenoSessionService.getEffectiveBalance(walletAddress);

    res.json({
      success: true,
      data: {
        hasActiveSession: !!session,
        session: session ? {
          id: session.id,
          gamesPlayed: session.games_played,
          totalWagered: parseFloat(session.total_wagered),
          totalWon: parseFloat(session.total_won),
          netResult: parseFloat(session.total_won) - parseFloat(session.total_wagered),
          startedAt: session.session_start
        } : null,
        balances: {
          contractBalance: balances.contractBalance,
          effectiveBalance: balances.effectiveBalance,
          sessionNetResult: balances.sessionNetResult
        }
      }
    });
  } catch (err) {
    console.error('[Keno] Error getting session:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener sesión'
    });
  }
});

/**
 * POST /api/keno/session/settle
 * Liquidar sesion activa con el contrato
 */
router.post('/session/settle', requireFlag('game_keno'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;

    console.log(`[Keno] Settling session for ${walletAddress}`);

    const result = await kenoSessionService.settleSession(walletAddress);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[Keno] Error settling session:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Error al liquidar sesión'
    });
  }
});

/**
 * GET /api/keno/session/settle
 * Liquidar sesión via sendBeacon (acepta wallet como query param)
 * Usado cuando el usuario cierra la pestaña
 */
router.get('/session/settle', async (req, res) => {
  try {
    const walletAddress = req.query.wallet;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address required'
      });
    }

    console.log(`[Keno] Settling session via beacon for ${walletAddress}`);

    const result = await kenoSessionService.settleSession(walletAddress);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[Keno] Error settling session via beacon:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Error al liquidar sesión'
    });
  }
});

/**
 * POST /api/keno/session/start
 * Iniciar o reanudar una sesion de Keno
 */
router.post('/session/start', requireFlag('game_keno'), authenticateWallet, async (req, res) => {
  try {
    const walletAddress = req.user.address;

    // Liquidar sesiones pendientes antiguas primero
    await kenoSessionService.settlePendingSessions(walletAddress);

    // Crear o obtener sesión activa
    const session = await kenoSessionService.getOrCreateSession(walletAddress);
    const balances = await kenoSessionService.getEffectiveBalance(walletAddress);

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        balances: {
          contractBalance: balances.contractBalance,
          effectiveBalance: balances.effectiveBalance
        }
      }
    });
  } catch (err) {
    console.error('[Keno] Error starting session:', err);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar sesión'
    });
  }
});

// =================================
// RUTAS ADMIN
// =================================

/**
 * GET /api/keno/admin/stats
 * Estadisticas de Keno para admin
 * Requiere autenticación de administrador
 */
router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    const stats = await kenoService.getKenoStats(date_from, date_to);

    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('[Keno] Error getting stats:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadisticas'
    });
  }
});

// =================================
// RUTAS DE POOL (Admin)
// =================================

/**
 * GET /api/keno/admin/pool
 * Estado del pool de Keno
 */
router.get('/admin/pool', authenticate, requireAdmin, async (req, res) => {
  try {
    const stats = await kenoPoolHealthService.getPoolStats();
    const health = await kenoPoolHealthService.checkPoolHealth();

    res.json({
      success: true,
      data: {
        pool: stats?.pool || {},
        sessions: stats?.sessions || {},
        health
      }
    });
  } catch (err) {
    console.error('[Keno] Error getting pool status:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estado del pool'
    });
  }
});

/**
 * GET /api/keno/admin/sessions
 * Sesiones activas de Keno
 */
router.get('/admin/sessions', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status = 'active', limit = 50 } = req.query;

    const pool = require('../db');
    const result = await pool.query(
      `SELECT
         id, wallet_address, status, games_played,
         total_wagered, total_won,
         (total_won - total_wagered) as net_result,
         session_start, updated_at
       FROM keno_sessions
       WHERE status = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [status, parseInt(limit)]
    );

    res.json({
      success: true,
      data: {
        sessions: result.rows.map(row => ({
          id: row.id,
          walletAddress: row.wallet_address,
          status: row.status,
          gamesPlayed: row.games_played,
          totalWagered: parseFloat(row.total_wagered),
          totalWon: parseFloat(row.total_won),
          netResult: parseFloat(row.net_result),
          sessionStart: row.session_start,
          updatedAt: row.updated_at
        })),
        count: result.rows.length
      }
    });
  } catch (err) {
    console.error('[Keno] Error getting sessions:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener sesiones'
    });
  }
});

/**
 * GET /api/keno/admin/pool-history
 * Historial del pool para graficos
 */
router.get('/admin/pool-history', authenticate, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;

    const history = await kenoPoolHealthService.getPoolHistory(days);

    res.json({
      success: true,
      data: {
        history,
        days
      }
    });
  } catch (err) {
    console.error('[Keno] Error getting pool history:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial del pool'
    });
  }
});

// =================================
// RUTAS DE VRF (Public + Admin)
// =================================

/**
 * GET /api/keno/verify/:gameId
 * Verificar un juego (Provably Fair)
 * Publico para transparencia
 */
router.get('/verify/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;

    const verification = await kenoVrfService.getGameVerificationStatus(gameId);

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: 'Juego no encontrado'
      });
    }

    res.json({
      success: true,
      data: verification
    });
  } catch (err) {
    console.error('[Keno] Error verifying game:', err);
    res.status(500).json({
      success: false,
      message: 'Error al verificar juego'
    });
  }
});

/**
 * GET /api/keno/admin/vrf/stats
 * Estadisticas VRF para admin
 */
router.get('/admin/vrf/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const stats = await kenoVrfService.getVrfStats();
    const kenoVrfRequester = require('../scheduler/kenoVrfRequester');
    const systemStatus = await kenoVrfRequester.getVrfSystemStatus();

    res.json({
      success: true,
      data: {
        ...stats,
        system: systemStatus
      }
    });
  } catch (err) {
    console.error('[Keno] Error getting VRF stats:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadisticas VRF'
    });
  }
});

/**
 * POST /api/keno/admin/vrf/batch
 * Forzar creacion de batch VRF (admin)
 */
router.post('/admin/vrf/batch', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await kenoVrfService.createVrfBatch();

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[Keno] Error creating VRF batch:', err);
    res.status(500).json({
      success: false,
      message: 'Error al crear batch VRF'
    });
  }
});

module.exports = router;
