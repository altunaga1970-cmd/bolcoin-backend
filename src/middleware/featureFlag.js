/**
 * Feature Flag Middleware
 *
 * Middleware para proteger rutas basado en feature flags.
 * Retorna 403 FEATURE_DISABLED si el flag esta deshabilitado.
 */

const featureFlagService = require('../services/featureFlagService');

/**
 * Middleware factory que requiere un flag habilitado
 * @param {string} flagKey - Key del flag a verificar
 * @returns {Function} Express middleware
 *
 * Uso:
 *   router.post('/play', requireFlag('game_keno'), controller.play);
 */
function requireFlag(flagKey) {
  return async (req, res, next) => {
    try {
      // Verificar modo mantenimiento primero
      const isMaintenanceMode = await featureFlagService.isMaintenanceMode();
      if (isMaintenanceMode) {
        return res.status(503).json({
          success: false,
          error: 'MAINTENANCE_MODE',
          message: 'El sistema esta en mantenimiento. Intenta de nuevo mas tarde.'
        });
      }

      // Obtener wallet del usuario (si esta autenticado)
      const walletAddress = req.user?.address || req.headers['x-wallet-address'];

      // Verificar flag (incluye verificacion de whitelist por wallet)
      const isEnabled = walletAddress
        ? await featureFlagService.isEnabledForWallet(flagKey, walletAddress)
        : await featureFlagService.isEnabled(flagKey);

      if (!isEnabled) {
        console.log(`[FeatureFlag] Access denied to ${flagKey} for ${walletAddress || 'anonymous'}`);

        return res.status(403).json({
          success: false,
          error: 'FEATURE_DISABLED',
          message: `La funcion '${flagKey}' no esta disponible actualmente.`,
          flag: flagKey
        });
      }

      // Flag habilitado, continuar
      next();

    } catch (err) {
      console.error('[FeatureFlag] Error checking flag:', err);
      // Fail closed: deny access when flag service is unavailable
      return res.status(503).json({
        success: false,
        message: 'Servicio temporalmente no disponible. Intente mas tarde.',
        flag: flagKey
      });
    }
  };
}

/**
 * Middleware que solo verifica (no bloquea)
 * Agrega req.featureFlags con el estado de los flags
 */
async function loadFeatureFlags(req, res, next) {
  try {
    req.featureFlags = await featureFlagService.getFlagsSimple();
    next();
  } catch (err) {
    console.error('[FeatureFlag] Error loading flags:', err);
    req.featureFlags = {};
    next();
  }
}

/**
 * Middleware para verificar multiples flags (todos deben estar habilitados)
 * @param {string[]} flagKeys - Array de keys a verificar
 */
function requireAllFlags(flagKeys) {
  return async (req, res, next) => {
    try {
      const walletAddress = req.user?.address || req.headers['x-wallet-address'];

      for (const flagKey of flagKeys) {
        const isEnabled = walletAddress
          ? await featureFlagService.isEnabledForWallet(flagKey, walletAddress)
          : await featureFlagService.isEnabled(flagKey);

        if (!isEnabled) {
          return res.status(403).json({
            success: false,
            error: 'FEATURE_DISABLED',
            message: `La funcion '${flagKey}' no esta disponible.`,
            flag: flagKey
          });
        }
      }

      next();

    } catch (err) {
      console.error('[FeatureFlag] Error checking flags:', err);
      return res.status(503).json({
        success: false,
        message: 'Servicio temporalmente no disponible. Intente mas tarde.'
      });
    }
  };
}

/**
 * Middleware para verificar al menos un flag (OR)
 * @param {string[]} flagKeys - Array de keys a verificar
 */
function requireAnyFlag(flagKeys) {
  return async (req, res, next) => {
    try {
      const walletAddress = req.user?.address || req.headers['x-wallet-address'];

      for (const flagKey of flagKeys) {
        const isEnabled = walletAddress
          ? await featureFlagService.isEnabledForWallet(flagKey, walletAddress)
          : await featureFlagService.isEnabled(flagKey);

        if (isEnabled) {
          next();
          return;
        }
      }

      // Ninguno habilitado
      return res.status(403).json({
        success: false,
        error: 'FEATURE_DISABLED',
        message: 'Ninguna de las funciones requeridas esta disponible.',
        flags: flagKeys
      });

    } catch (err) {
      console.error('[FeatureFlag] Error checking flags:', err);
      return res.status(503).json({
        success: false,
        message: 'Servicio temporalmente no disponible. Intente mas tarde.'
      });
    }
  };
}

module.exports = {
  requireFlag,
  requireAllFlags,
  requireAnyFlag,
  loadFeatureFlags
};
