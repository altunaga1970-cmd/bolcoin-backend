/**
 * Migration: Add Keno VRF Support
 *
 * Agrega columnas para verificacion VRF de juegos de Keno:
 * - server_seed: Seed del servidor para reproducibilidad
 * - client_seed: Seed opcional del cliente
 * - nonce: Contador para generar seeds unicos
 * - vrf_verified: Estado de verificacion VRF
 * - vrf_batch_id: Referencia al batch VRF
 *
 * Crea tabla para batches VRF:
 * - keno_vrf_batches: Agrupa juegos para verificacion en lote
 *
 * Crea tabla para historial del pool:
 * - keno_pool_history: Snapshots para graficos
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('[Migration] Adding VRF columns to keno_games...');

    // Agregar columnas VRF a keno_games
    await client.query(`
      ALTER TABLE keno_games
        ADD COLUMN IF NOT EXISTS server_seed VARCHAR(64),
        ADD COLUMN IF NOT EXISTS client_seed VARCHAR(64),
        ADD COLUMN IF NOT EXISTS nonce INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS vrf_verified BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS vrf_batch_id INTEGER
    `);

    console.log('[Migration] Creating keno_vrf_batches table...');

    // Crear tabla de batches VRF
    await client.query(`
      CREATE TABLE IF NOT EXISTS keno_vrf_batches (
        id SERIAL PRIMARY KEY,
        batch_hash VARCHAR(64) NOT NULL,
        games_count INTEGER NOT NULL DEFAULT 0,
        start_game_id INTEGER,
        end_game_id INTEGER,
        vrf_request_id VARCHAR(100),
        vrf_random_word VARCHAR(78),
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        verified_at TIMESTAMP,
        CONSTRAINT valid_status CHECK (status IN ('pending', 'requested', 'verified', 'failed'))
      )
    `);

    // Crear indice para busqueda de batches pendientes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_vrf_batches_status
        ON keno_vrf_batches(status)
    `);

    // Crear indice para buscar juegos no verificados
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_games_vrf_verified
        ON keno_games(vrf_verified)
        WHERE vrf_verified = FALSE
    `);

    console.log('[Migration] Creating keno_pool_history table...');

    // Crear tabla de historial del pool
    await client.query(`
      CREATE TABLE IF NOT EXISTS keno_pool_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        balance DECIMAL(15, 6) NOT NULL,
        games_count INTEGER DEFAULT 0,
        total_bets DECIMAL(15, 6) DEFAULT 0,
        total_payouts DECIMAL(15, 6) DEFAULT 0,
        active_sessions INTEGER DEFAULT 0,
        pending_payouts DECIMAL(15, 6) DEFAULT 0,
        UNIQUE(timestamp)
      )
    `);

    // Crear indice para consultas por fecha
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_pool_history_timestamp
        ON keno_pool_history(timestamp DESC)
    `);

    console.log('[Migration] Adding game_config entries for VRF...');

    // Agregar configuraciones VRF
    await client.query(`
      INSERT INTO game_config (key, value, value_type)
      VALUES
        ('keno_vrf_batch_interval_hours', '1', 'number'),
        ('keno_vrf_min_batch_size', '10', 'number'),
        ('keno_vrf_max_batch_size', '1000', 'number'),
        ('keno_vrf_enabled', 'false', 'boolean'),
        ('keno_max_session_hours', '24', 'number'),
        ('keno_settle_warning_hours', '20', 'number')
      ON CONFLICT (key) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('[Migration] Keno VRF migration completed successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error in Keno VRF migration:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('[Migration] Reverting Keno VRF migration...');

    // Eliminar columnas VRF de keno_games
    await client.query(`
      ALTER TABLE keno_games
        DROP COLUMN IF EXISTS server_seed,
        DROP COLUMN IF EXISTS client_seed,
        DROP COLUMN IF EXISTS nonce,
        DROP COLUMN IF EXISTS vrf_verified,
        DROP COLUMN IF EXISTS vrf_batch_id
    `);

    // Eliminar tabla de batches VRF
    await client.query('DROP TABLE IF EXISTS keno_vrf_batches');

    // Eliminar tabla de historial
    await client.query('DROP TABLE IF EXISTS keno_pool_history');

    // Eliminar configuraciones VRF
    await client.query(`
      DELETE FROM game_config
      WHERE key IN (
        'keno_vrf_batch_interval_hours',
        'keno_vrf_min_batch_size',
        'keno_vrf_max_batch_size',
        'keno_vrf_enabled'
      )
    `);

    await client.query('COMMIT');
    console.log('[Migration] Keno VRF migration reverted');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error reverting Keno VRF migration:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Ejecutar migracion si se llama directamente
if (require.main === module) {
  const direction = process.argv[2] || 'up';

  if (direction === 'up') {
    up()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else if (direction === 'down') {
    down()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    console.error('Usage: node add-keno-vrf.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
