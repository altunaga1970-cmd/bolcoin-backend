/**
 * Migration: Add room_number to bingo_rounds
 *
 * Supports 4 parallel bingo rooms with staggered timing.
 */

const { pool } = require('../../config/database');

async function up() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE bingo_rounds
      ADD COLUMN IF NOT EXISTS room_number INTEGER DEFAULT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bingo_rounds_room
      ON bingo_rounds(room_number)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bingo_rounds_room_status
      ON bingo_rounds(room_number, status)
    `);

    await client.query('COMMIT');
    console.log('[Migration] add-bingo-room-number: OK');
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
    await client.query('DROP INDEX IF EXISTS idx_bingo_rounds_room_status');
    await client.query('DROP INDEX IF EXISTS idx_bingo_rounds_room');
    await client.query('ALTER TABLE bingo_rounds DROP COLUMN IF EXISTS room_number');
    await client.query('COMMIT');
    console.log('[Migration] add-bingo-room-number rollback: OK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
