/**
 * Migration: Add Keno Sessions Table
 *
 * Sistema de sesiones para liquidación batch de Keno
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Tabla de sesiones de Keno
    await client.query(`
      CREATE TABLE IF NOT EXISTS keno_sessions (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) NOT NULL,
        session_start TIMESTAMP DEFAULT NOW(),
        total_wagered DECIMAL(14,6) DEFAULT 0,
        total_won DECIMAL(14,6) DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        settled_at TIMESTAMP,
        settlement_tx VARCHAR(66),
        settlement_error TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Índices
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_sessions_wallet ON keno_sessions(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_keno_sessions_status ON keno_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_keno_sessions_wallet_active ON keno_sessions(wallet_address, status) WHERE status = 'active';
    `);

    // Constraint: solo 1 sesión activa por wallet
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_keno_sessions_unique_active
      ON keno_sessions(wallet_address)
      WHERE status = 'active'
    `);

    // Agregar columna session_id a keno_games para vincular
    await client.query(`
      ALTER TABLE keno_games
      ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES keno_sessions(id)
    `);

    await client.query('COMMIT');
    console.log('[Migration] Keno sessions table created successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error creating keno sessions table:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Quitar columna de keno_games
    await client.query(`
      ALTER TABLE keno_games DROP COLUMN IF EXISTS session_id
    `);

    // Eliminar tabla
    await client.query('DROP TABLE IF EXISTS keno_sessions CASCADE');

    await client.query('COMMIT');
    console.log('[Migration] Keno sessions table dropped successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error dropping keno sessions table:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  const action = process.argv[2];

  if (action === 'up') {
    up().then(() => process.exit(0)).catch(() => process.exit(1));
  } else if (action === 'down') {
    down().then(() => process.exit(0)).catch(() => process.exit(1));
  } else {
    console.log('Usage: node add-keno-sessions.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
