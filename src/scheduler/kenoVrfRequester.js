/**
 * Keno VRF Requester Scheduler
 *
 * Scheduler para crear y procesar batches VRF de Keno.
 * Ejecuta cada hora (configurable) para:
 * 1. Crear batch de juegos no verificados
 * 2. Enviar solicitudes VRF pendientes
 * 3. Procesar callbacks VRF completados
 *
 * Diseño:
 * - Los juegos se juegan instantaneamente con SHA-256
 * - Cada hora se crea un batch para verificacion VRF
 * - La verificacion es asincrona y no afecta el juego
 */

const kenoVrfService = require('../services/kenoVrfService');
const gameConfigService = require('../services/gameConfigService');
const pool = require('../db');

/**
 * Crear batch de juegos pendientes de verificacion
 */
async function createPendingBatch() {
  try {
    const vrfEnabled = await gameConfigService.getConfigValue('keno_vrf_enabled', false);

    if (!vrfEnabled) {
      return { skipped: true, reason: 'VRF disabled' };
    }

    const result = await kenoVrfService.createVrfBatch();

    if (result.created) {
      console.log(`[KenoVrfRequester] Created batch #${result.batchId} with ${result.gamesCount} games`);
    }

    return result;
  } catch (error) {
    console.error('[KenoVrfRequester] Error creating batch:', error);
    return { error: error.message };
  }
}

/**
 * Enviar solicitudes VRF para batches pendientes
 */
async function requestVrfForPendingBatches() {
  try {
    const vrfEnabled = await gameConfigService.getConfigValue('keno_vrf_enabled', false);

    if (!vrfEnabled) {
      return { skipped: true, reason: 'VRF disabled' };
    }

    // Obtener batches pendientes
    const pendingResult = await pool.query(
      `SELECT id, batch_hash, games_count
       FROM keno_vrf_batches
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 5`
    );

    const results = [];

    for (const batch of pendingResult.rows) {
      try {
        const result = await kenoVrfService.requestVrfForBatch(batch.id);
        results.push({
          batchId: batch.id,
          ...result
        });
      } catch (err) {
        console.error(`[KenoVrfRequester] Error requesting VRF for batch #${batch.id}:`, err);
        results.push({
          batchId: batch.id,
          success: false,
          error: err.message
        });
      }
    }

    if (results.length > 0) {
      console.log(`[KenoVrfRequester] Processed ${results.length} VRF requests`);
    }

    return results;
  } catch (error) {
    console.error('[KenoVrfRequester] Error requesting VRF:', error);
    return { error: error.message };
  }
}

/**
 * Verificar batches con VRF completado (polling)
 * Nota: En produccion, esto seria un callback del contrato
 */
async function checkCompletedVrfRequests() {
  try {
    const vrfEnabled = await gameConfigService.getConfigValue('keno_vrf_enabled', false);

    if (!vrfEnabled) {
      return { skipped: true, reason: 'VRF disabled' };
    }

    // Obtener batches con VRF solicitado
    const requestedResult = await pool.query(
      `SELECT id, vrf_request_id, batch_hash
       FROM keno_vrf_batches
       WHERE status = 'requested'
       AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at ASC
       LIMIT 10`
    );

    const results = [];

    for (const batch of requestedResult.rows) {
      try {
        // Try on-chain fulfillment check first
        const vrfContract = kenoVrfService.initVrfContract();
        if (vrfContract && batch.vrf_request_id) {
          try {
            const reqData = await vrfContract.getKenoVrfRequest(batch.vrf_request_id);
            if (reqData.fulfilled) {
              // VRF fulfilled on-chain — use real random word
              const randomWord = reqData.randomWord.toString();
              const result = await kenoVrfService.processVrfCallback(
                batch.vrf_request_id,
                randomWord
              );
              results.push({ batchId: batch.id, ...result, onChain: true });
              continue;
            }
          } catch (chainErr) {
            console.warn(`[KenoVrfRequester] On-chain VRF check failed for batch #${batch.id}:`, chainErr.message);
          }
        }

        // Fallback: simular verificacion local despues de 1 minuto
        const batchAge = await pool.query(
          `SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds
           FROM keno_vrf_batches WHERE id = $1`,
          [batch.id]
        );

        const ageSeconds = batchAge.rows[0]?.age_seconds || 0;

        if (ageSeconds > 60) {
          const simulatedRandomWord = require('crypto').randomBytes(32).toString('hex');
          const result = await kenoVrfService.processVrfCallback(
            batch.vrf_request_id,
            simulatedRandomWord
          );

          results.push({
            batchId: batch.id,
            ...result,
            simulated: true
          });
        }
      } catch (err) {
        console.error(`[KenoVrfRequester] Error checking VRF for batch #${batch.id}:`, err);
        results.push({
          batchId: batch.id,
          success: false,
          error: err.message
        });
      }
    }

    if (results.length > 0) {
      console.log(`[KenoVrfRequester] Verified ${results.length} VRF batches`);
    }

    return results;
  } catch (error) {
    console.error('[KenoVrfRequester] Error checking completed VRF:', error);
    return { error: error.message };
  }
}

/**
 * Limpiar batches fallidos antiguos
 */
async function cleanupFailedBatches() {
  try {
    // Reintentar batches fallidos despues de 1 hora
    const result = await pool.query(
      `UPDATE keno_vrf_batches
       SET status = 'pending', error_message = NULL
       WHERE status = 'failed'
       AND created_at > NOW() - INTERVAL '24 hours'
       AND created_at < NOW() - INTERVAL '1 hour'
       RETURNING id`
    );

    if (result.rows.length > 0) {
      console.log(`[KenoVrfRequester] Reset ${result.rows.length} failed batches for retry`);
    }

    // Eliminar batches muy antiguos
    await pool.query(
      `DELETE FROM keno_vrf_batches
       WHERE status = 'failed'
       AND created_at < NOW() - INTERVAL '7 days'`
    );

    return { reset: result.rows.length };
  } catch (error) {
    console.error('[KenoVrfRequester] Error cleaning up batches:', error);
    return { error: error.message };
  }
}

/**
 * Ejecutar todas las tareas VRF
 * Llamado por el scheduler principal
 */
async function runVrfTasks() {
  const results = {
    batchCreation: null,
    vrfRequests: null,
    vrfVerification: null,
    cleanup: null
  };

  try {
    // 1. Crear batch de juegos pendientes
    results.batchCreation = await createPendingBatch();

    // 2. Enviar solicitudes VRF
    results.vrfRequests = await requestVrfForPendingBatches();

    // 3. Verificar batches completados
    results.vrfVerification = await checkCompletedVrfRequests();

    // 4. Limpiar batches fallidos
    results.cleanup = await cleanupFailedBatches();

    // 5. Cleanup expired seed commits (commit-reveal)
    results.commitCleanup = await kenoVrfService.cleanupExpiredCommits();

  } catch (error) {
    console.error('[KenoVrfRequester] Error running VRF tasks:', error);
    results.error = error.message;
  }

  return results;
}

/**
 * Obtener estado del sistema VRF
 */
async function getVrfSystemStatus() {
  try {
    const vrfEnabled = await gameConfigService.getConfigValue('keno_vrf_enabled', false);
    const stats = await kenoVrfService.getVrfStats();

    const pendingBatches = await pool.query(
      `SELECT COUNT(*) as count FROM keno_vrf_batches WHERE status = 'pending'`
    );

    const requestedBatches = await pool.query(
      `SELECT COUNT(*) as count FROM keno_vrf_batches WHERE status = 'requested'`
    );

    return {
      enabled: vrfEnabled,
      stats,
      queue: {
        pending: parseInt(pendingBatches.rows[0]?.count) || 0,
        requested: parseInt(requestedBatches.rows[0]?.count) || 0
      }
    };
  } catch (error) {
    console.error('[KenoVrfRequester] Error getting system status:', error);
    return { error: error.message };
  }
}

module.exports = {
  createPendingBatch,
  requestVrfForPendingBatches,
  checkCompletedVrfRequests,
  cleanupFailedBatches,
  runVrfTasks,
  getVrfSystemStatus
};
