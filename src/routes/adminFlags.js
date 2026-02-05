/**
 * Admin Flags Routes
 *
 * Endpoints para gestionar feature flags (admin only).
 * Protegido por autenticacion SIWE o wallet admin.
 *
 * GET  /api/admin/flags         - Listar todos los flags
 * PATCH /api/admin/flags/:key   - Actualizar un flag
 * POST /api/admin/flags/invalidate-cache - Invalidar cache
 */

const express = require('express');
const router = express.Router();
const featureFlagService = require('../services/featureFlagService');
const gameConfigService = require('../services/gameConfigService');
const { authenticateWallet, requireAdminWallet } = require('../middleware/web3Auth');

// Todas las rutas requieren admin
router.use(authenticateWallet);
router.use(requireAdminWallet);

/**
 * GET /api/admin/flags
 * Listar todos los feature flags con sus estados
 */
router.get('/', async (req, res) => {
  try {
    const flags = await featureFlagService.getAllFlags();

    res.json({
      success: true,
      data: {
        flags,
        cacheInfo: {
          ttlSeconds: 60,
          note: 'Los cambios pueden tardar hasta 60s en propagarse'
        }
      }
    });

  } catch (err) {
    console.error('[AdminFlags] Error getting flags:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener flags'
    });
  }
});

/**
 * PATCH /api/admin/flags/:key
 * Actualizar un flag especifico
 *
 * Body: { enabled: boolean, metadata?: object }
 */
router.patch('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { enabled, metadata } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Campo "enabled" (boolean) es requerido'
      });
    }

    const flag = await featureFlagService.setFlag(key, enabled, metadata);

    // Log de auditoria
    console.log(`[AdminFlags] Flag '${key}' changed to ${enabled} by ${req.user.address}`);

    res.json({
      success: true,
      message: `Flag '${key}' actualizado a ${enabled}`,
      data: flag
    });

  } catch (err) {
    console.error('[AdminFlags] Error updating flag:', err);

    if (err.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: err.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error al actualizar flag'
    });
  }
});

/**
 * POST /api/admin/flags/invalidate-cache
 * Invalidar cache de flags (para emergencias)
 */
router.post('/invalidate-cache', async (req, res) => {
  try {
    featureFlagService.invalidateCache();
    gameConfigService.invalidateCache();

    console.log(`[AdminFlags] Cache invalidated by ${req.user.address}`);

    res.json({
      success: true,
      message: 'Cache invalidado exitosamente'
    });

  } catch (err) {
    console.error('[AdminFlags] Error invalidating cache:', err);
    res.status(500).json({
      success: false,
      message: 'Error al invalidar cache'
    });
  }
});

/**
 * GET /api/admin/flags/:key/wallets
 * Obtener wallets en whitelist de un flag
 */
router.get('/:key/wallets', async (req, res) => {
  try {
    const { key } = req.params;
    const wallets = await featureFlagService.getWhitelistedWallets(key);

    res.json({
      success: true,
      data: {
        flag: key,
        wallets
      }
    });

  } catch (err) {
    console.error('[AdminFlags] Error getting whitelist:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener whitelist'
    });
  }
});

/**
 * POST /api/admin/flags/:key/wallets
 * Agregar wallet a whitelist de un flag
 *
 * Body: { wallet: string, reason?: string }
 */
router.post('/:key/wallets', async (req, res) => {
  try {
    const { key } = req.params;
    const { wallet, reason } = req.body;

    if (!wallet) {
      return res.status(400).json({
        success: false,
        message: 'Campo "wallet" es requerido'
      });
    }

    await featureFlagService.addWalletToFlag(key, wallet, reason);

    console.log(`[AdminFlags] Wallet ${wallet} added to ${key} whitelist by ${req.user.address}`);

    res.json({
      success: true,
      message: `Wallet agregada a whitelist de '${key}'`
    });

  } catch (err) {
    console.error('[AdminFlags] Error adding wallet to whitelist:', err);
    res.status(500).json({
      success: false,
      message: 'Error al agregar wallet'
    });
  }
});

/**
 * DELETE /api/admin/flags/:key/wallets/:wallet
 * Remover wallet de whitelist
 */
router.delete('/:key/wallets/:wallet', async (req, res) => {
  try {
    const { key, wallet } = req.params;

    await featureFlagService.removeWalletFromFlag(key, wallet);

    console.log(`[AdminFlags] Wallet ${wallet} removed from ${key} whitelist by ${req.user.address}`);

    res.json({
      success: true,
      message: `Wallet removida de whitelist de '${key}'`
    });

  } catch (err) {
    console.error('[AdminFlags] Error removing wallet from whitelist:', err);
    res.status(500).json({
      success: false,
      message: 'Error al remover wallet'
    });
  }
});

/**
 * GET /api/admin/flags/config
 * Obtener toda la configuracion de juegos
 */
router.get('/config', async (req, res) => {
  try {
    const config = await gameConfigService.getAllConfig();

    res.json({
      success: true,
      data: config
    });

  } catch (err) {
    console.error('[AdminFlags] Error getting config:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener configuracion'
    });
  }
});

/**
 * PATCH /api/admin/flags/config/:key
 * Actualizar un valor de configuracion
 *
 * Body: { value: any, type?: string }
 */
router.patch('/config/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value, type } = req.body;

    if (value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Campo "value" es requerido'
      });
    }

    const config = await gameConfigService.setConfigValue(key, value, type);

    console.log(`[AdminFlags] Config '${key}' changed by ${req.user.address}`);

    res.json({
      success: true,
      message: `Config '${key}' actualizado`,
      data: config
    });

  } catch (err) {
    console.error('[AdminFlags] Error updating config:', err);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar configuracion'
    });
  }
});

module.exports = router;
