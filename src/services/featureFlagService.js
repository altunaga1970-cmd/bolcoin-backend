/**
 * Feature Flag Service
 *
 * Gestiona feature flags desde PostgreSQL con cache de 60 segundos.
 * - Controla habilitacion/deshabilitacion de juegos
 * - Soporta acceso beta por wallet
 * - Cache para reducir queries a BD
 */

const pool = require('../db');

// Cache de flags (60 segundos)
let flagsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 segundos

/**
 * Invalidar cache (para emergencias o actualizaciones admin)
 */
function invalidateCache() {
  flagsCache = null;
  cacheTimestamp = 0;
  console.log('[FeatureFlags] Cache invalidated');
}

/**
 * Verificar si el cache es valido
 */
function isCacheValid() {
  return flagsCache && (Date.now() - cacheTimestamp) < CACHE_TTL_MS;
}

/**
 * Obtener todos los flags desde BD o cache
 */
async function getAllFlags() {
  if (isCacheValid()) {
    return flagsCache;
  }

  try {
    const result = await pool.query(
      'SELECT key, enabled, description, metadata FROM feature_flags'
    );

    // Convertir a objeto { key: enabled }
    const flags = {};
    for (const row of result.rows) {
      flags[row.key] = {
        enabled: row.enabled,
        description: row.description,
        metadata: row.metadata || {}
      };
    }

    // Actualizar cache
    flagsCache = flags;
    cacheTimestamp = Date.now();

    return flags;

  } catch (err) {
    console.error('[FeatureFlags] Error getting flags:', err);
    // Si hay error, devolver cache viejo o defaults
    return flagsCache || getDefaultFlags();
  }
}

/**
 * Flags por defecto (fallback si BD no disponible)
 */
function getDefaultFlags() {
  return {
    game_keno: { enabled: true, description: 'Keno MVP', metadata: {} },
    game_bolita: { enabled: true, description: 'La Bolita', metadata: {} },
    game_fortuna: { enabled: false, description: 'La Fortuna', metadata: { coming_soon: true } },
    feature_history: { enabled: true, description: 'Historial', metadata: {} },
    feature_deposits: { enabled: true, description: 'Depositos', metadata: {} },
    feature_withdrawals: { enabled: true, description: 'Retiros', metadata: {} },
    maintenance_mode: { enabled: false, description: 'Mantenimiento', metadata: {} }
  };
}

/**
 * Verificar si un flag esta habilitado
 */
async function isEnabled(flagKey) {
  const flags = await getAllFlags();
  const flag = flags[flagKey];
  return flag ? flag.enabled : false;
}

/**
 * Verificar si un flag esta habilitado para una wallet especifica
 * (Soporta beta access)
 */
async function isEnabledForWallet(flagKey, walletAddress) {
  // Primero verificar flag global
  const globalEnabled = await isEnabled(flagKey);
  if (globalEnabled) {
    return true;
  }

  // Si no esta habilitado globalmente, verificar whitelist
  if (!walletAddress) {
    return false;
  }

  try {
    const result = await pool.query(
      'SELECT 1 FROM feature_flag_wallets WHERE flag_key = $1 AND wallet_address = $2',
      [flagKey, walletAddress.toLowerCase()]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error('[FeatureFlags] Error checking wallet whitelist:', err);
    return false;
  }
}

/**
 * Obtener flag simplificado (solo enabled: true/false)
 */
async function getFlagsSimple() {
  const flags = await getAllFlags();
  const simple = {};
  for (const [key, value] of Object.entries(flags)) {
    simple[key] = value.enabled;
  }
  return simple;
}

/**
 * Actualizar un flag (admin only)
 */
async function setFlag(flagKey, enabled, metadata = null) {
  try {
    const updateFields = ['enabled = $2', 'updated_at = NOW()'];
    const params = [flagKey, enabled];

    if (metadata !== null) {
      updateFields.push(`metadata = $${params.length + 1}`);
      params.push(JSON.stringify(metadata));
    }

    const result = await pool.query(
      `UPDATE feature_flags SET ${updateFields.join(', ')} WHERE key = $1 RETURNING *`,
      params
    );

    // Invalidar cache
    invalidateCache();

    if (result.rows.length === 0) {
      throw new Error(`Flag '${flagKey}' not found`);
    }

    console.log(`[FeatureFlags] Flag '${flagKey}' set to ${enabled}`);
    return result.rows[0];

  } catch (err) {
    console.error('[FeatureFlags] Error setting flag:', err);
    throw err;
  }
}

/**
 * Agregar wallet a whitelist de un flag
 */
async function addWalletToFlag(flagKey, walletAddress, reason = null) {
  try {
    await pool.query(
      `INSERT INTO feature_flag_wallets (flag_key, wallet_address, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (flag_key, wallet_address) DO UPDATE SET reason = EXCLUDED.reason`,
      [flagKey, walletAddress.toLowerCase(), reason]
    );

    console.log(`[FeatureFlags] Wallet ${walletAddress} added to ${flagKey} whitelist`);
    return true;

  } catch (err) {
    console.error('[FeatureFlags] Error adding wallet to flag:', err);
    throw err;
  }
}

/**
 * Remover wallet de whitelist
 */
async function removeWalletFromFlag(flagKey, walletAddress) {
  try {
    await pool.query(
      'DELETE FROM feature_flag_wallets WHERE flag_key = $1 AND wallet_address = $2',
      [flagKey, walletAddress.toLowerCase()]
    );

    console.log(`[FeatureFlags] Wallet ${walletAddress} removed from ${flagKey} whitelist`);
    return true;

  } catch (err) {
    console.error('[FeatureFlags] Error removing wallet from flag:', err);
    throw err;
  }
}

/**
 * Obtener wallets en whitelist de un flag
 */
async function getWhitelistedWallets(flagKey) {
  try {
    const result = await pool.query(
      'SELECT wallet_address, reason, created_at FROM feature_flag_wallets WHERE flag_key = $1',
      [flagKey]
    );
    return result.rows;
  } catch (err) {
    console.error('[FeatureFlags] Error getting whitelisted wallets:', err);
    return [];
  }
}

/**
 * Verificar modo mantenimiento
 */
async function isMaintenanceMode() {
  return await isEnabled('maintenance_mode');
}

module.exports = {
  getAllFlags,
  getFlagsSimple,
  isEnabled,
  isEnabledForWallet,
  setFlag,
  addWalletToFlag,
  removeWalletFromFlag,
  getWhitelistedWallets,
  isMaintenanceMode,
  invalidateCache,
  getDefaultFlags
};
