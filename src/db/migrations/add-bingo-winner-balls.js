/**
 * Migration: Add line_winner_ball and bingo_winner_ball to bingo_rounds
 *
 * These columns store the ball number at which the first line/bingo was hit.
 * Used by the scheduler to calculate draw animation duration.
 */

const { pool } = require('../../config/database');

async function up() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE bingo_rounds
      ADD COLUMN IF NOT EXISTS line_winner_ball  INTEGER DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS bingo_winner_ball INTEGER DEFAULT NULL
    `);

    await client.query('COMMIT');
    console.log('[Migration] add-bingo-winner-balls: OK');
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
    await client.query(`
      ALTER TABLE bingo_rounds
      DROP COLUMN IF EXISTS line_winner_ball,
      DROP COLUMN IF EXISTS bingo_winner_ball
    `);
    await client.query('COMMIT');
    console.log('[Migration] add-bingo-winner-balls rollback: OK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
