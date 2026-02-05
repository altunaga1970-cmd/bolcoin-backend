/**
 * Migration: Add Keno Tables
 *
 * Tablas para el juego de Keno (Opcion 3 - Hibrido)
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Tabla principal de juegos de Keno
    await client.query(`
      CREATE TABLE IF NOT EXISTS keno_games (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(50) UNIQUE NOT NULL,
        wallet_address VARCHAR(42) NOT NULL,
        selected_numbers JSONB NOT NULL,
        drawn_numbers JSONB NOT NULL,
        matched_numbers JSONB NOT NULL,
        spots INTEGER NOT NULL,
        hits INTEGER NOT NULL,
        bet_amount DECIMAL(14, 6) NOT NULL,
        multiplier DECIMAL(10, 2) NOT NULL DEFAULT 0,
        payout DECIMAL(14, 6) NOT NULL DEFAULT 0,
        net_result DECIMAL(14, 6) NOT NULL,
        seed VARCHAR(64) NOT NULL,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        settled BOOLEAN DEFAULT FALSE,
        settled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Indices para keno_games
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_games_wallet ON keno_games(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_keno_games_timestamp ON keno_games(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_keno_games_settled ON keno_games(settled);
    `);

    // Tabla de fees de Keno (para tracking de 50% fee / 50% reserva)
    await client.query(`
      CREATE TABLE IF NOT EXISTS keno_fees (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(50) REFERENCES keno_games(game_id),
        fee_amount DECIMAL(14, 6) NOT NULL,
        reserve_amount DECIMAL(14, 6) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Indice para keno_fees
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_fees_game ON keno_fees(game_id);
    `);

    // Tabla de settlements (para cuando se asienten los balances virtuales)
    await client.query(`
      CREATE TABLE IF NOT EXISTS keno_settlements (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) NOT NULL,
        amount DECIMAL(14, 6) NOT NULL,
        direction VARCHAR(10) NOT NULL, -- 'credit' o 'debit'
        tx_hash VARCHAR(66),
        status VARCHAR(20) DEFAULT 'pending',
        games_settled INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);

    // Indice para settlements
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_settlements_wallet ON keno_settlements(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_keno_settlements_status ON keno_settlements(status);
    `);

    await client.query('COMMIT');
    console.log('[Migration] Keno tables created successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error creating keno tables:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query('DROP TABLE IF EXISTS keno_settlements CASCADE');
    await client.query('DROP TABLE IF EXISTS keno_fees CASCADE');
    await client.query('DROP TABLE IF EXISTS keno_games CASCADE');

    await client.query('COMMIT');
    console.log('[Migration] Keno tables dropped successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error dropping keno tables:', err);
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
    console.log('Usage: node add-keno-tables.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
