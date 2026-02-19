/**
 * Migration: Add draw_started_at to bingo_rounds
 *
 * Supports synchronized multiplayer drawing phase.
 * All clients calculate visible ball from (now - draw_started_at) / 4500ms.
 */

const { pool } = require('../../config/database');

async function up() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE bingo_rounds
      ADD COLUMN IF NOT EXISTS draw_started_at TIMESTAMP DEFAULT NULL
    `);

    await client.query('COMMIT');
    console.log('[Migration] add-bingo-draw-started: OK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE bingo_rounds DROP COLUMN IF EXISTS draw_started_at');
    await client.query('COMMIT');
    console.log('[Migration] add-bingo-draw-started rollback: OK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
