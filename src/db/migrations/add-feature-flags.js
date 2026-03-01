/**
 * Migration: Add Feature Flags, Game Config and Admin Wallets
 *
 * MVP Keno - Sistema de feature flags para controlar juegos
 *
 * Tablas:
 * - feature_flags: Control de features por key
 * - feature_flag_wallets: Beta access por wallet
 * - admin_wallets: Lista de admins en BD
 * - game_config: Configuracion dinamica de juegos
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // =====================================================
    // 1. TABLA: feature_flags
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id SERIAL PRIMARY KEY,
        key VARCHAR(50) UNIQUE NOT NULL,
        enabled BOOLEAN DEFAULT false,
        description TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(key);
      CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(enabled);
    `);

    // =====================================================
    // 2. TABLA: feature_flag_wallets (beta access)
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS feature_flag_wallets (
        id SERIAL PRIMARY KEY,
        flag_key VARCHAR(50) NOT NULL,
        wallet_address VARCHAR(42) NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(flag_key, wallet_address)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ff_wallets_wallet ON feature_flag_wallets(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_ff_wallets_flag ON feature_flag_wallets(flag_key);
    `);

    // =====================================================
    // 3. TABLA: admin_wallets
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_wallets (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) UNIQUE NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'operator',
        enabled BOOLEAN DEFAULT true,
        created_by VARCHAR(42),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT valid_admin_role CHECK (role IN ('superadmin', 'operator', 'auditor'))
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_wallets_address ON admin_wallets(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_admin_wallets_enabled ON admin_wallets(enabled);
    `);

    // =====================================================
    // 4. TABLA: game_config
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_config (
        id SERIAL PRIMARY KEY,
        key VARCHAR(50) UNIQUE NOT NULL,
        value TEXT NOT NULL,
        value_type VARCHAR(20) DEFAULT 'string',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT valid_config_type CHECK (value_type IN ('string', 'number', 'boolean', 'json'))
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_config_key ON game_config(key);
    `);

    // =====================================================
    // 5. TRIGGER: auto-update updated_at
    // =====================================================
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    // Aplicar trigger a todas las tablas
    const tables = ['feature_flags', 'game_config', 'admin_wallets'];
    for (const table of tables) {
      await client.query(`
        DROP TRIGGER IF EXISTS update_${table}_updated_at ON ${table};
        CREATE TRIGGER update_${table}_updated_at
          BEFORE UPDATE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
      `);
    }

    // =====================================================
    // 6. SEEDS: Feature Flags (MVP)
    // =====================================================
    await client.query(`
      INSERT INTO feature_flags (key, enabled, description, metadata) VALUES
        ('game_keno', true, 'Juego Keno - activo en MVP', '{"priority": 1}'),
        ('game_bolita', true, 'La Bolita - non-custodial betting', '{}'),
        ('game_fortuna', false, 'La Fortuna (Loteria) - proximamente', '{"coming_soon": true}'),
        ('feature_history', true, 'Historial de jugadas', '{}'),
        ('feature_deposits', true, 'Depositos de USDT', '{}'),
        ('feature_withdrawals', true, 'Retiros de USDT', '{}'),
        ('maintenance_mode', false, 'Modo mantenimiento global', '{}')
      ON CONFLICT (key) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        description = EXCLUDED.description,
        updated_at = CURRENT_TIMESTAMP
    `);

    // =====================================================
    // 7. SEEDS: Game Config (Keno MVP - 12% fee)
    // =====================================================
    await client.query(`
      INSERT INTO game_config (key, value, value_type, description) VALUES
        ('keno_bet_amount', '1', 'number', 'Apuesta fija en USDT'),
        ('keno_fee_bps', '1200', 'number', 'Fee operador en basis points (1200 = 12%)'),
        ('keno_pool_bps', '8800', 'number', 'Pool/reserva en basis points (8800 = 88%)'),
        ('keno_max_payout', '50', 'number', 'Maximo pago por jugada en USDT'),
        ('keno_min_spots', '1', 'number', 'Minimo de numeros a elegir'),
        ('keno_max_spots', '10', 'number', 'Maximo de numeros a elegir'),
        ('keno_total_numbers', '80', 'number', 'Numeros disponibles (1-80)'),
        ('keno_drawn_numbers', '20', 'number', 'Numeros sorteados por jugada'),
        ('contract_min_balance', '100', 'number', 'Balance minimo del contrato para operar'),
        ('rng_method', 'sha256_server_seed', 'string', 'Metodo RNG: sha256_server_seed (Provably Fair)')
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        description = EXCLUDED.description,
        updated_at = CURRENT_TIMESTAMP
    `);

    await client.query('COMMIT');
    console.log('[Migration] Feature flags, game config and admin wallets tables created successfully');
    console.log('[Migration] Seeds inserted: game_keno=true, game_bolita=true, game_fortuna=false');
    console.log('[Migration] Keno config: betAmount=1 USDT, feeBps=1200 (12%), maxPayout=50 USDT');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error creating tables:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Drop triggers first
    await client.query('DROP TRIGGER IF EXISTS update_feature_flags_updated_at ON feature_flags');
    await client.query('DROP TRIGGER IF EXISTS update_game_config_updated_at ON game_config');
    await client.query('DROP TRIGGER IF EXISTS update_admin_wallets_updated_at ON admin_wallets');

    // Drop tables
    await client.query('DROP TABLE IF EXISTS feature_flag_wallets CASCADE');
    await client.query('DROP TABLE IF EXISTS feature_flags CASCADE');
    await client.query('DROP TABLE IF EXISTS admin_wallets CASCADE');
    await client.query('DROP TABLE IF EXISTS game_config CASCADE');

    // Note: We don't drop the function as it might be used elsewhere

    await client.query('COMMIT');
    console.log('[Migration] Feature flags tables dropped successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error dropping tables:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  const action = process.argv[2];

  if (action === 'up') {
    up().then(() => {
      console.log('[Migration] Done');
      process.exit(0);
    }).catch((err) => {
      console.error('[Migration] Failed:', err.message);
      process.exit(1);
    });
  } else if (action === 'down') {
    down().then(() => {
      console.log('[Migration] Rollback done');
      process.exit(0);
    }).catch((err) => {
      console.error('[Migration] Rollback failed:', err.message);
      process.exit(1);
    });
  } else {
    console.log('Usage: node add-feature-flags.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
