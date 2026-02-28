/**
 * Migration: Widen bingo_rounds winner columns from VARCHAR(42) to TEXT
 *
 * line_winner and bingo_winner were created as VARCHAR(42) (single address),
 * but the scheduler writes JSON arrays like '["0xabc...","0xdef..."]' which
 * exceeds 42 chars and causes "value too long for type character varying(42)".
 *
 * TEXT is compatible with VARCHAR — this is a zero-downtime ALTER.
 */

const { pool } = require('../../config/database');

async function up() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE bingo_rounds
        ALTER COLUMN line_winner  TYPE TEXT,
        ALTER COLUMN bingo_winner TYPE TEXT
    `);

    await client.query('COMMIT');
    console.log('[Migration] fix-bingo-winner-varchar: OK');
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

    // Truncate back to 42 chars — data loss possible if values are longer
    await client.query(`
      ALTER TABLE bingo_rounds
        ALTER COLUMN line_winner  TYPE VARCHAR(42) USING LEFT(line_winner, 42),
        ALTER COLUMN bingo_winner TYPE VARCHAR(42) USING LEFT(bingo_winner, 42)
    `);

    await client.query('COMMIT');
    console.log('[Migration] fix-bingo-winner-varchar rollback: OK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
