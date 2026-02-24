/**
 * Database Initialization Script
 *
 * Runs base schema (idempotent) + all migrations in order.
 * Safe to run multiple times - uses IF NOT EXISTS / ON CONFLICT everywhere.
 *
 * Usage:
 *   node src/db/init.js          # Run all migrations
 *   npm run db:init              # Same via npm script
 *
 * Called automatically on server startup when DB connects.
 */

const { pool, testConnection } = require('../config/database');
const fs = require('fs');
const path = require('path');

// SQL migrations in order (files that run raw SQL via pool.query)
const SQL_MIGRATIONS = [
  '002-add-audit-logs.sql',
  '003-add-claims-tables.sql',
  '004-add-prize-config-tables.sql',
  '005-update-draw-status-check.sql',
  '006-add-winning-columns.sql',
  '007-create-operator-fees-table.sql',
  '008-add-risk-management-tables.sql',
  '009-add-wallet-address.sql',
  '011-bankroll-exposure-system.sql',
  '012-admin-metrics-referrals.sql',
  '013-add-lottery-columns.sql',
];

// JS migrations in order (files with up() function)
const JS_MIGRATIONS = [
  'add-payments-tables.js',
  'add-vrf-columns.js',
  'add-keno-tables.js',
  'add-keno-sessions.js',
  'add-keno-vrf.js',
  'add-feature-flags.js',
  'add-keno-security-fixes.js',
  'add-keno-phase3.js',
  'add-bolita-chain-index.js',
  'add-bingo-tables.js',
  'add-bingo-room-number.js',
  'add-bingo-draw-started.js',
  'enable-bingo.js',
];

async function runBaseSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.log('[DB Init] No schema.sql found, skipping base schema');
    return;
  }

  // Instead of running the DROP+CREATE schema (destructive),
  // only create tables IF NOT EXISTS
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE,
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255) NOT NULL DEFAULT 'web3-auth',
        role VARCHAR(20) DEFAULT 'user',
        balance DECIMAL(12, 2) DEFAULT 0.00,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        version INTEGER DEFAULT 0,
        wallet_address VARCHAR(42) UNIQUE
      )
    `);

    // Draws table
    await client.query(`
      CREATE TABLE IF NOT EXISTS draws (
        id SERIAL PRIMARY KEY,
        draw_number VARCHAR(50) UNIQUE NOT NULL,
        draw_type VARCHAR(20) DEFAULT 'bolita',
        scheduled_time TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        winning_number CHAR(4),
        result_entered_at TIMESTAMP,
        result_entered_by INTEGER REFERENCES users(id),
        total_bets_amount DECIMAL(12, 2) DEFAULT 0.00,
        total_payouts_amount DECIMAL(12, 2) DEFAULT 0.00,
        bets_count INTEGER DEFAULT 0,
        winners_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS bets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        draw_id INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
        game_type VARCHAR(20) NOT NULL,
        bet_number VARCHAR(4) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        potential_payout DECIMAL(12, 2) NOT NULL,
        multiplier INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        actual_payout DECIMAL(12, 2) DEFAULT 0.00,
        parent_bet_id INTEGER REFERENCES bets(id),
        is_corrido_child BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      )
    `);

    // Transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        transaction_type VARCHAR(20) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        balance_before DECIMAL(12, 2) NOT NULL,
        balance_after DECIMAL(12, 2) NOT NULL,
        reference_type VARCHAR(20),
        reference_id INTEGER,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Game settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id)
      )
    `);

    // Insert default game settings
    await client.query(`
      INSERT INTO game_settings (setting_key, setting_value, description) VALUES
        ('fijos_multiplier', '80', 'Multiplicador Fijos'),
        ('centenas_multiplier', '500', 'Multiplicador Centenas'),
        ('parles_multiplier', '900', 'Multiplicador Parles'),
        ('max_bet_amount', '1000', 'Max apuesta USDT'),
        ('min_bet_amount', '1', 'Min apuesta USDT'),
        ('betting_enabled', 'true', 'Apuestas activadas')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    // Create indices (IF NOT EXISTS)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_draws_scheduled_time ON draws(scheduled_time);
      CREATE INDEX IF NOT EXISTS idx_draws_status ON draws(status);
      CREATE INDEX IF NOT EXISTS idx_draws_draw_number ON draws(draw_number);
      CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
      CREATE INDEX IF NOT EXISTS idx_bets_draw_id ON bets(draw_id);
      CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
      CREATE INDEX IF NOT EXISTS idx_bets_created_at ON bets(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
    `);

    // Create updated_at trigger function
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query('COMMIT');
    console.log('[DB Init] Base schema applied (IF NOT EXISTS)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function runSqlMigration(filename) {
  const filePath = path.join(__dirname, 'migrations', filename);
  if (!fs.existsSync(filePath)) {
    console.log(`[DB Init] Skipping missing SQL migration: ${filename}`);
    return;
  }

  const sql = fs.readFileSync(filePath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log(`[DB Init] SQL migration applied: ${filename}`);
  } catch (err) {
    // Many SQL migrations use IF NOT EXISTS, so errors are rare
    // but log and continue for non-critical failures
    if (err.message.includes('already exists')) {
      console.log(`[DB Init] SQL migration already applied: ${filename}`);
    } else {
      console.error(`[DB Init] SQL migration error (${filename}):`, err.message);
    }
  } finally {
    client.release();
  }
}

async function runJsMigration(filename) {
  const filePath = path.join(__dirname, 'migrations', filename);
  if (!fs.existsSync(filePath)) {
    console.log(`[DB Init] Skipping missing JS migration: ${filename}`);
    return;
  }

  try {
    const migration = require(filePath);
    if (typeof migration.up === 'function') {
      await migration.up();
      console.log(`[DB Init] JS migration applied: ${filename}`);
    } else if (typeof migration === 'function') {
      await migration();
      console.log(`[DB Init] JS migration applied: ${filename}`);
    }
  } catch (err) {
    if (err.message.includes('already exists') || err.message.includes('duplicate key')) {
      console.log(`[DB Init] JS migration already applied: ${filename}`);
    } else {
      console.error(`[DB Init] JS migration error (${filename}):`, err.message);
    }
  }
}

async function initDatabase() {
  console.log('[DB Init] Starting database initialization...');

  // Step 1: Base schema
  await runBaseSchema();

  // Step 2: SQL migrations in order
  for (const file of SQL_MIGRATIONS) {
    await runSqlMigration(file);
  }

  // Step 3: JS migrations in order
  for (const file of JS_MIGRATIONS) {
    await runJsMigration(file);
  }

  console.log('[DB Init] Database initialization complete');
}

// Run directly: node src/db/init.js
if (require.main === module) {
  testConnection()
    .then(connected => {
      if (!connected) {
        console.error('[DB Init] Cannot connect to database');
        process.exit(1);
      }
      return initDatabase();
    })
    .then(() => {
      console.log('[DB Init] Done');
      process.exit(0);
    })
    .catch(err => {
      console.error('[DB Init] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { initDatabase };
