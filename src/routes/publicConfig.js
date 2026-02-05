/**
 * Public Config Routes
 *
 * Endpoint publico para obtener configuracion del sistema.
 * El frontend usa esto para obtener flags, params de juegos, etc.
 *
 * GET /api/public-config
 */

const express = require('express');
const router = express.Router();
const featureFlagService = require('../services/featureFlagService');
const gameConfigService = require('../services/gameConfigService');

/**
 * GET /api/public-config
 * Obtener configuracion publica (flags + params de juegos)
 *
 * Response:
 * {
 *   flags: { game_keno: true, game_bolita: false, ... },
 *   keno: { betAmount: 1, feeBps: 1200, maxPayout: 50, ... },
 *   contract: { address: "0x...", network: "polygon" }
 * }
 */
router.get('/', async (req, res) => {
  try {
    // Obtener flags simplificados (key: boolean)
    const flags = await featureFlagService.getFlagsSimple();

    // Obtener config publica de juegos
    const gameConfig = await gameConfigService.getPublicConfig();

    // Obtener datos del contrato desde env
    const contractAddress = process.env.CONTRACT_ADDRESS || null;
    const network = process.env.NETWORK || 'polygon';

    res.json({
      success: true,
      data: {
        // Feature flags
        flags,

        // Configuracion de Keno
        keno: gameConfig.keno,

        // Info del sistema
        system: {
          rngMethod: gameConfig.system.rngMethod,
          version: '1.0.0-mvp'
        },

        // Info del contrato (si esta configurado)
        contract: contractAddress ? {
          address: contractAddress,
          network
        } : null
      }
    });

  } catch (err) {
    console.error('[PublicConfig] Error getting config:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener configuracion'
    });
  }
});

/**
 * GET /api/public-config/flags
 * Solo flags (version ligera)
 */
router.get('/flags', async (req, res) => {
  try {
    const flags = await featureFlagService.getFlagsSimple();

    res.json({
      success: true,
      data: flags
    });

  } catch (err) {
    console.error('[PublicConfig] Error getting flags:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener flags'
    });
  }
});

/**
 * GET /api/public-config/keno
 * Solo config de Keno
 */
router.get('/keno', async (req, res) => {
  try {
    const kenoConfig = await gameConfigService.getKenoConfig();

    res.json({
      success: true,
      data: kenoConfig
    });

  } catch (err) {
    console.error('[PublicConfig] Error getting keno config:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener configuracion de Keno'
    });
  }
});

module.exports = router;
