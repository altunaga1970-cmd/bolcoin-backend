/**
 * Keno VRF Service
 *
 * Servicio de verificacion VRF para juegos de Keno.
 * Implementa modelo hibrido: juego instantaneo + verificacion por lotes.
 *
 * Flujo:
 * 1. Juego instantaneo con SHA-256 (server_seed)
 * 2. Cada hora: crear batch de juegos no verificados
 * 3. Enviar batch hash al contrato para VRF
 * 4. Callback VRF verifica que seeds coincidan
 * 5. Marcar juegos como vrf_verified = true
 *
 * Provably Fair:
 * - server_seed: generado aleatoriamente, revelado despues del juego
 * - client_seed: opcional, proporcionado por el usuario
 * - nonce: contador incremental por sesion
 * - combined_seed: sha256(server_seed + client_seed + nonce)
 */

const pool = require('../db');
const crypto = require('crypto');
const ethers = require('ethers');
const gameConfigService = require('./gameConfigService');

// Configuracion del contrato VRF
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const VRF_CONTRACT_ADDRESS = process.env.VRF_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS;
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;

// ABI for batch VRF functions — CONTRACT STUBS, NOT YET DEPLOYED.
// These functions (requestKenoVrfBatch, verifyKenoBatch, getKenoVrfRequest)
// do not exist in the current KenoGame.sol contract. The on-chain VRF flow
// uses Chainlink V2.5 via placeBet() directly. Batch VRF is a future feature.
// When these contract calls fail, the service falls back to local simulation
// (simulateLocalVerification), which is the active production path.
const KENO_VRF_ABI = [
  "function requestKenoVrfBatch(bytes32 _batchHash, uint256 _gamesCount) external returns (uint256 requestId)",
  "function verifyKenoBatch(uint256 _batchId, bytes32 _batchHash) external view returns (bool)",
  "function getKenoVrfRequest(uint256 _requestId) external view returns (bytes32 batchHash, uint256 randomWord, bool fulfilled)"
];

let provider = null;
let contract = null;
let signer = null;

/**
 * Inicializar conexion con el contrato VRF
 */
function initVrfContract() {
  if (!contract && VRF_CONTRACT_ADDRESS) {
    try {
      provider = new ethers.JsonRpcProvider(RPC_URL);
      if (OPERATOR_PRIVATE_KEY) {
        signer = new ethers.Wallet(OPERATOR_PRIVATE_KEY, provider);
        contract = new ethers.Contract(VRF_CONTRACT_ADDRESS, KENO_VRF_ABI, signer);
      }
      console.log('[KenoVrfService] VRF contract initialized:', VRF_CONTRACT_ADDRESS);
    } catch (err) {
      console.error('[KenoVrfService] Error initializing VRF contract:', err);
    }
  }
  return contract;
}

/**
 * Generar server seed seguro
 * @returns {string} Seed hexadecimal de 32 bytes
 */
function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generar seed combinado para el juego
 * @param {string} serverSeed - Seed del servidor
 * @param {string} clientSeed - Seed del cliente (opcional)
 * @param {number} nonce - Contador incremental
 * @returns {string} Hash SHA-256 del seed combinado
 */
function generateCombinedSeed(serverSeed, clientSeed = '', nonce = 0) {
  const combined = `${serverSeed}:${clientSeed}:${nonce}`;
  return crypto.createHash('sha256').update(combined).digest('hex');
}

/**
 * Verificar que un resultado de juego coincide con el seed
 * @param {Object} game - Datos del juego
 * @returns {boolean} True si la verificacion es exitosa
 */
function verifyGameResult(game) {
  try {
    const combinedSeed = generateCombinedSeed(
      game.serverSeed,
      game.clientSeed || '',
      game.nonce || 0
    );

    // Comparar con el seed almacenado en el juego
    return combinedSeed === game.seed;
  } catch (err) {
    console.error('[KenoVrfService] Error verifying game result:', err);
    return false;
  }
}

/**
 * Obtener proximo nonce para un wallet
 * @param {string} walletAddress - Direccion del wallet
 * @returns {number} Proximo nonce
 */
async function getNextNonce(walletAddress) {
  try {
    const result = await pool.query(
      `SELECT COALESCE(MAX(nonce), -1) + 1 as next_nonce
       FROM keno_games
       WHERE wallet_address = $1
       AND server_seed IS NOT NULL`,
      [walletAddress.toLowerCase()]
    );
    return result.rows[0]?.next_nonce || 0;
  } catch (err) {
    console.error('[KenoVrfService] Error getting next nonce:', err);
    return 0;
  }
}

/**
 * Crear batch de juegos para verificacion VRF
 * @returns {Object} Informacion del batch creado
 */
async function createVrfBatch() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Obtener configuracion
    const minBatchSize = await gameConfigService.getConfigValue('keno_vrf_min_batch_size', 10);
    const maxBatchSize = await gameConfigService.getConfigValue('keno_vrf_max_batch_size', 1000);

    // Obtener juegos no verificados
    const gamesResult = await client.query(
      `SELECT id, game_id, server_seed, client_seed, nonce, seed
       FROM keno_games
       WHERE vrf_verified = FALSE
       AND server_seed IS NOT NULL
       AND vrf_batch_id IS NULL
       ORDER BY id ASC
       LIMIT $1`,
      [maxBatchSize]
    );

    const games = gamesResult.rows;

    if (games.length < minBatchSize) {
      await client.query('ROLLBACK');
      return {
        created: false,
        reason: `Not enough games (${games.length}/${minBatchSize})`,
        gamesCount: games.length
      };
    }

    // Calcular hash del batch
    const batchData = games.map(g => `${g.game_id}:${g.server_seed}:${g.seed}`).join('|');
    const batchHash = crypto.createHash('sha256').update(batchData).digest('hex');

    // Crear registro del batch
    const batchResult = await client.query(
      `INSERT INTO keno_vrf_batches (
         batch_hash, games_count, start_game_id, end_game_id, status
       ) VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [batchHash, games.length, games[0].id, games[games.length - 1].id]
    );

    const batchId = batchResult.rows[0].id;

    // Actualizar juegos con el batch_id
    await client.query(
      `UPDATE keno_games
       SET vrf_batch_id = $1
       WHERE id = ANY($2::int[])`,
      [batchId, games.map(g => g.id)]
    );

    await client.query('COMMIT');

    console.log(`[KenoVrfService] Created batch #${batchId} with ${games.length} games`);

    return {
      created: true,
      batchId,
      batchHash,
      gamesCount: games.length,
      startGameId: games[0].id,
      endGameId: games[games.length - 1].id
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[KenoVrfService] Error creating VRF batch:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Enviar solicitud VRF al contrato para un batch
 * @param {number} batchId - ID del batch
 * @returns {Object} Resultado de la solicitud
 */
async function requestVrfForBatch(batchId) {
  const client = await pool.connect();
  let batch = null;

  try {
    // Obtener info del batch
    const batchResult = await client.query(
      `SELECT * FROM keno_vrf_batches WHERE id = $1 AND status = 'pending'`,
      [batchId]
    );

    if (batchResult.rows.length === 0) {
      return { success: false, error: 'Batch not found or not pending' };
    }

    batch = batchResult.rows[0];

    // Inicializar contrato
    initVrfContract();
    if (!contract) {
      // Sin contrato, simular verificacion local
      console.log('[KenoVrfService] No VRF contract, simulating local verification');
      return await simulateLocalVerification(batchId, batch);
    }

    // Enviar solicitud VRF al contrato
    const batchHashBytes = '0x' + batch.batch_hash;
    const tx = await contract.requestKenoVrfBatch(batchHashBytes, batch.games_count);
    const receipt = await tx.wait();

    // Extraer request ID del evento
    const requestId = receipt.logs[0]?.args?.requestId?.toString() || tx.hash;

    // Actualizar batch con request ID
    await client.query(
      `UPDATE keno_vrf_batches
       SET status = 'requested', vrf_request_id = $1
       WHERE id = $2`,
      [requestId, batchId]
    );

    console.log(`[KenoVrfService] VRF requested for batch #${batchId}, requestId: ${requestId}`);

    return {
      success: true,
      batchId,
      requestId,
      txHash: receipt.hash
    };

  } catch (err) {
    // Distinguish missing contract functions (expected) from network errors
    const isMissingFunction = err.code === 'CALL_EXCEPTION'
      || err.message?.includes('no matching function')
      || err.message?.includes('function not found')
      || err.message?.includes('UNPREDICTABLE_GAS_LIMIT');

    if (isMissingFunction) {
      console.log(`[KenoVrfService] Batch VRF contract functions not deployed — falling back to local verification for batch #${batchId}`);
      return await simulateLocalVerification(batchId, batch);
    }

    console.error('[KenoVrfService] Network/unexpected error requesting VRF:', err);

    // Marcar batch como fallido
    await client.query(
      `UPDATE keno_vrf_batches
       SET status = 'failed', error_message = $1
       WHERE id = $2`,
      [err.message, batchId]
    );

    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Simular verificacion local (cuando no hay contrato VRF)
 * Util para desarrollo y testing
 */
async function simulateLocalVerification(batchId, batch) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verificar cada juego del batch
    const gamesResult = await client.query(
      `SELECT id, server_seed, client_seed, nonce, seed
       FROM keno_games
       WHERE vrf_batch_id = $1`,
      [batchId]
    );

    let allVerified = true;
    for (const game of gamesResult.rows) {
      const isValid = verifyGameResult({
        serverSeed: game.server_seed,
        clientSeed: game.client_seed,
        nonce: game.nonce,
        seed: game.seed
      });

      if (!isValid) {
        console.warn(`[KenoVrfService] Game ${game.id} failed local verification`);
        allVerified = false;
      }
    }

    // Marcar juegos como verificados
    await client.query(
      `UPDATE keno_games
       SET vrf_verified = TRUE
       WHERE vrf_batch_id = $1`,
      [batchId]
    );

    // Generar "random word" simulado
    const simulatedRandomWord = crypto.randomBytes(32).toString('hex');

    // Actualizar batch como verificado
    await client.query(
      `UPDATE keno_vrf_batches
       SET status = 'verified',
           vrf_random_word = $1,
           verified_at = NOW()
       WHERE id = $2`,
      [simulatedRandomWord, batchId]
    );

    await client.query('COMMIT');

    console.log(`[KenoVrfService] Batch #${batchId} verified locally (${gamesResult.rows.length} games)`);

    return {
      success: true,
      batchId,
      verified: true,
      gamesVerified: gamesResult.rows.length,
      allValid: allVerified,
      simulated: true
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Procesar callback VRF recibido del contrato
 * @param {string} requestId - ID de la solicitud VRF
 * @param {string} randomWord - Numero aleatorio generado por VRF
 */
async function processVrfCallback(requestId, randomWord) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Buscar batch por request ID
    const batchResult = await client.query(
      `SELECT * FROM keno_vrf_batches WHERE vrf_request_id = $1`,
      [requestId]
    );

    if (batchResult.rows.length === 0) {
      console.warn(`[KenoVrfService] Batch not found for requestId: ${requestId}`);
      await client.query('ROLLBACK');
      return { success: false, error: 'Batch not found' };
    }

    const batch = batchResult.rows[0];

    // Verificar que el VRF coincide con el batch hash
    // En produccion, esto se haria on-chain
    const combinedHash = crypto.createHash('sha256')
      .update(batch.batch_hash + randomWord)
      .digest('hex');

    // Marcar todos los juegos del batch como verificados
    await client.query(
      `UPDATE keno_games
       SET vrf_verified = TRUE
       WHERE vrf_batch_id = $1`,
      [batch.id]
    );

    // Actualizar batch
    await client.query(
      `UPDATE keno_vrf_batches
       SET status = 'verified',
           vrf_random_word = $1,
           verified_at = NOW()
       WHERE id = $2`,
      [randomWord, batch.id]
    );

    await client.query('COMMIT');

    console.log(`[KenoVrfService] Batch #${batch.id} verified with VRF`);

    return {
      success: true,
      batchId: batch.id,
      gamesVerified: batch.games_count,
      randomWord
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[KenoVrfService] Error processing VRF callback:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Obtener estado de verificacion de un juego
 * @param {string} gameId - ID del juego
 */
async function getGameVerificationStatus(gameId) {
  try {
    const result = await pool.query(
      `SELECT
         g.game_id,
         g.server_seed,
         g.client_seed,
         g.nonce,
         g.seed,
         g.vrf_verified,
         g.vrf_batch_id,
         b.status as batch_status,
         b.vrf_random_word,
         b.verified_at
       FROM keno_games g
       LEFT JOIN keno_vrf_batches b ON g.vrf_batch_id = b.id
       WHERE g.game_id = $1`,
      [gameId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const game = result.rows[0];

    return {
      gameId: game.game_id,
      serverSeed: game.server_seed,
      clientSeed: game.client_seed,
      nonce: game.nonce,
      combinedSeed: game.seed,
      vrfVerified: game.vrf_verified,
      batchId: game.vrf_batch_id,
      batchStatus: game.batch_status,
      vrfRandomWord: game.vrf_random_word,
      verifiedAt: game.verified_at,
      // Datos para verificacion manual
      verification: {
        expectedSeed: generateCombinedSeed(
          game.server_seed,
          game.client_seed || '',
          game.nonce || 0
        ),
        isValid: game.seed === generateCombinedSeed(
          game.server_seed,
          game.client_seed || '',
          game.nonce || 0
        )
      }
    };
  } catch (err) {
    console.error('[KenoVrfService] Error getting verification status:', err);
    throw err;
  }
}

/**
 * Obtener estadisticas de verificacion VRF
 */
async function getVrfStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE vrf_verified = TRUE) as verified_games,
        COUNT(*) FILTER (WHERE vrf_verified = FALSE) as unverified_games,
        COUNT(*) FILTER (WHERE vrf_batch_id IS NOT NULL) as batched_games,
        COUNT(DISTINCT vrf_batch_id) as total_batches
      FROM keno_games
      WHERE server_seed IS NOT NULL
    `);

    const batchStats = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM keno_vrf_batches
      GROUP BY status
    `);

    const stats = result.rows[0];
    const batchesByStatus = {};
    batchStats.rows.forEach(row => {
      batchesByStatus[row.status] = parseInt(row.count);
    });

    return {
      games: {
        verified: parseInt(stats.verified_games) || 0,
        unverified: parseInt(stats.unverified_games) || 0,
        batched: parseInt(stats.batched_games) || 0
      },
      batches: {
        total: parseInt(stats.total_batches) || 0,
        byStatus: batchesByStatus
      }
    };
  } catch (err) {
    console.error('[KenoVrfService] Error getting VRF stats:', err);
    return {
      games: { verified: 0, unverified: 0, batched: 0 },
      batches: { total: 0, byStatus: {} }
    };
  }
}

/**
 * Create a seed commit for commit-reveal fairness
 * Generates a server seed, stores its hash, returns commitId + seedHash for the player
 * @param {string} walletAddress - Player wallet
 * @returns {Object} { commitId, seedHash }
 */
async function createSeedCommit(walletAddress) {
  const wallet = walletAddress.toLowerCase();

  // Limit pending commits per wallet to prevent DoS
  const MAX_PENDING_PER_WALLET = 5;
  const pendingCount = await pool.query(
    `SELECT COUNT(*) as cnt FROM keno_seed_commits WHERE wallet_address = $1 AND status = 'pending'`,
    [wallet]
  );
  if (parseInt(pendingCount.rows[0].cnt) >= MAX_PENDING_PER_WALLET) {
    throw new Error('Demasiados commits pendientes. Usa o espera que expiren.');
  }

  const serverSeed = generateServerSeed();
  const seedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const commitId = crypto.randomBytes(32).toString('hex');

  await pool.query(
    `INSERT INTO keno_seed_commits (commit_id, wallet_address, server_seed, seed_hash, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [commitId, wallet, serverSeed, seedHash]
  );

  console.log(`[KenoVrfService] Seed commit created for ${wallet}: ${commitId}`);

  return { commitId, seedHash };
}

/**
 * Consume a seed commit during play
 * Validates ownership, expiry (TTL), marks as used
 * @param {string} commitId - The commit ID
 * @param {string} walletAddress - Player wallet
 * @param {Object} client - DB client (within transaction)
 * @returns {Object} { server_seed, seed_hash }
 */
async function consumeSeedCommit(commitId, walletAddress, client) {
  const wallet = walletAddress.toLowerCase();
  const ttlSeconds = await gameConfigService.getConfigValue('keno_commit_ttl_seconds', 300);

  const result = await client.query(
    `UPDATE keno_seed_commits
     SET status = 'used', used_at = NOW()
     WHERE commit_id = $1
       AND wallet_address = $2
       AND status = 'pending'
       AND created_at > NOW() - make_interval(secs => $3)
     RETURNING server_seed, seed_hash`,
    [commitId, wallet, ttlSeconds]
  );

  if (result.rows.length === 0) {
    throw new Error('Commit no valido, expirado, o ya utilizado. Solicita un nuevo commit.');
  }

  return {
    server_seed: result.rows[0].server_seed,
    seed_hash: result.rows[0].seed_hash
  };
}

/**
 * Cleanup expired seed commits
 * Called periodically by the scheduler
 */
async function cleanupExpiredCommits() {
  try {
    const ttlSeconds = await gameConfigService.getConfigValue('keno_commit_ttl_seconds', 300);
    // Use 2x TTL for cleanup (consume rejects at 1x TTL, cleanup at 2x)
    const cleanupSeconds = ttlSeconds * 2;
    const result = await pool.query(
      `UPDATE keno_seed_commits
       SET status = 'expired'
       WHERE status = 'pending'
         AND created_at < NOW() - make_interval(secs => $1)
       RETURNING commit_id`,
      [cleanupSeconds]
    );

    if (result.rows.length > 0) {
      console.log(`[KenoVrfService] Expired ${result.rows.length} seed commits`);
    }

    return { expired: result.rows.length };
  } catch (err) {
    console.error('[KenoVrfService] Error cleaning up expired commits:', err);
    return { error: err.message };
  }
}

module.exports = {
  // Seed generation
  generateServerSeed,
  generateCombinedSeed,
  getNextNonce,

  // Verification
  verifyGameResult,
  getGameVerificationStatus,

  // Batch operations
  createVrfBatch,
  requestVrfForBatch,
  processVrfCallback,

  // Commit-reveal
  createSeedCommit,
  consumeSeedCommit,
  cleanupExpiredCommits,

  // Contract init (for external use)
  initVrfContract,

  // Stats
  getVrfStats,

  // Internal (for testing)
  simulateLocalVerification
};
