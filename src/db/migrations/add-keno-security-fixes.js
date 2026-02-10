/**
 * Migration: Keno Security Fixes (Phase 1)
 *
 * - Add CHECK(balance >= 0) constraint on keno_pool
 * - Add CHECK(balance >= 0) constraint on users
 * - Add unique partial index on keno_sessions for active sessions
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Add CHECK constraint on keno_pool balance (prevent negative pool)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_keno_pool_balance_non_negative'
        ) THEN
          ALTER TABLE keno_pool ADD CONSTRAINT chk_keno_pool_balance_non_negative CHECK (balance >= 0);
        END IF;
      END $$
    `);

    // 2. Add CHECK constraint on users balance (prevent negative user balance)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_balance_non_negative'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT chk_users_balance_non_negative CHECK (balance >= 0);
        END IF;
      END $$
    `);

    // 3. Ensure unique partial index on keno_sessions (one active session per wallet)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_keno_sessions_active_wallet
      ON keno_sessions (wallet_address) WHERE status = 'active'
    `);

    await client.query('COMMIT');
    console.log('[Migration] Keno security fixes applied successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error applying keno security fixes:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE keno_pool DROP CONSTRAINT IF EXISTS chk_keno_pool_balance_non_negative');
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_balance_non_negative');
    await client.query('DROP INDEX IF EXISTS idx_keno_sessions_active_wallet');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const action = process.argv[2];
  if (action === 'up') {
    up().then(() => process.exit(0)).catch(() => process.exit(1));
  } else if (action === 'down') {
    down().then(() => process.exit(0)).catch(() => process.exit(1));
  } else {
    console.log('Usage: node add-keno-security-fixes.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
