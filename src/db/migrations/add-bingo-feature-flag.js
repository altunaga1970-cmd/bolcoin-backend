/**
 * Migration: Add bingo_enabled to feature_flags table
 *
 * The original enable-bingo migration only wrote to game_config,
 * but requireFlag middleware reads from feature_flags.
 * This migration fixes the gap.
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO feature_flags (key, enabled, description, metadata)
      VALUES ('bingo_enabled', true, 'Bingo game - 4 rooms, 24/7', '{}')
      ON CONFLICT (key)
      DO UPDATE SET enabled = true, updated_at = CURRENT_TIMESTAMP
    `);

    await client.query('COMMIT');
    console.log('[Migration] ✓ bingo_enabled added to feature_flags (enabled=true)');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error adding bingo feature flag:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      DELETE FROM feature_flags WHERE key = 'bingo_enabled'
    `);

    await client.query('COMMIT');
    console.log('[Migration] ✓ bingo_enabled removed from feature_flags');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error removing bingo feature flag:', err);
    throw err;
  } finally {
    client.release();
  }
}

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
    console.log('Usage: node add-bingo-feature-flag.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
