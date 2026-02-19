/**
 * Migration: Enable Bingo Game
 *
 * Sets bingo_enabled=true in game_config table
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO game_config (key, value, value_type, description)
      VALUES ('bingo_enabled', 'true', 'boolean', 'Enable/disable Bingo game globally')
      ON CONFLICT (key)
      DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP
    `);

    await client.query('COMMIT');
    console.log('[Migration] ✓ Bingo enabled in game_config');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error enabling bingo:', err);
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
      UPDATE game_config
      SET value = 'false', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'bingo_enabled'
    `);

    await client.query('COMMIT');
    console.log('[Migration] ✓ Bingo disabled in game_config');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error disabling bingo:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Run if called directly
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
    console.log('Usage: node enable-bingo.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
