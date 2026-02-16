/**
 * Migration: Keno Phase 3 - Post-Launch Enhancements
 *
 * - New table: keno_seed_commits (for commit-reveal fairness)
 * - New columns on keno_games: seed_hash, commit_id
 * - New game_config entries: loss limits, feature flags, commit TTL
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Create keno_seed_commits table
    await client.query(`
      CREATE TABLE IF NOT EXISTS keno_seed_commits (
        id SERIAL PRIMARY KEY,
        commit_id VARCHAR(64) UNIQUE NOT NULL,
        wallet_address VARCHAR(42) NOT NULL,
        server_seed VARCHAR(128) NOT NULL,
        seed_hash VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'used', 'expired')),
        game_id VARCHAR(50) REFERENCES keno_games(game_id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        used_at TIMESTAMP
      )
    `);

    // Indices for keno_seed_commits
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_seed_commits_wallet_pending
      ON keno_seed_commits (wallet_address, status) WHERE status = 'pending'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_keno_seed_commits_created_at
      ON keno_seed_commits (created_at)
    `);

    // 2. Add new columns to keno_games (if not exist)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'keno_games' AND column_name = 'seed_hash'
        ) THEN
          ALTER TABLE keno_games ADD COLUMN seed_hash VARCHAR(64);
        END IF;
      END $$
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'keno_games' AND column_name = 'commit_id'
        ) THEN
          ALTER TABLE keno_games ADD COLUMN commit_id VARCHAR(64);
        END IF;
      END $$
    `);

    // 3. Insert game_config entries (loss limits + feature flags)
    const configEntries = [
      ['keno_daily_loss_limit', '100', 'number'],
      ['keno_session_loss_limit', '50', 'number'],
      ['keno_max_games_per_session', '200', 'number'],
      ['keno_commit_reveal_enabled', 'false', 'boolean'],
      ['keno_settlement_enabled', 'false', 'boolean'],
      ['keno_commit_ttl_seconds', '300', 'number']
    ];

    for (const [key, value, valueType] of configEntries) {
      await client.query(
        `INSERT INTO game_config (key, value, value_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, value, valueType]
      );
    }

    await client.query('COMMIT');
    console.log('[Migration] Keno Phase 3 migration applied successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error applying Keno Phase 3 migration:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Remove game_config entries
    await client.query(`
      DELETE FROM game_config WHERE key IN (
        'keno_daily_loss_limit',
        'keno_session_loss_limit',
        'keno_max_games_per_session',
        'keno_commit_reveal_enabled',
        'keno_settlement_enabled',
        'keno_commit_ttl_seconds'
      )
    `);

    // Remove columns from keno_games
    await client.query('ALTER TABLE keno_games DROP COLUMN IF EXISTS seed_hash');
    await client.query('ALTER TABLE keno_games DROP COLUMN IF EXISTS commit_id');

    // Drop keno_seed_commits table
    await client.query('DROP TABLE IF EXISTS keno_seed_commits');

    await client.query('COMMIT');
    console.log('[Migration] Keno Phase 3 migration rolled back successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error rolling back Keno Phase 3 migration:', err);
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
    console.log('Usage: node add-keno-phase3.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
