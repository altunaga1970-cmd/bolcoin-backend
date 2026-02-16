/**
 * Migration: Add chain_bet_index column to bets table
 *
 * Used by the Bolita event indexer to correlate on-chain bet indexes
 * with off-chain database records.
 */

const pool = require('../../db');

async function up() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Add chain_bet_index column (nullable, only set for on-chain bets)
    await client.query(`
      ALTER TABLE bets
      ADD COLUMN IF NOT EXISTS chain_bet_index INTEGER DEFAULT NULL
    `);

    // Add index for fast lookup by draw + chain_bet_index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bets_chain_index
      ON bets (draw_id, chain_bet_index)
      WHERE chain_bet_index IS NOT NULL
    `);

    await client.query('COMMIT');
    console.log('[Migration] add-bolita-chain-index: OK');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Migration] add-bolita-chain-index: FAILED', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DROP INDEX IF EXISTS idx_bets_chain_index');
    await client.query('ALTER TABLE bets DROP COLUMN IF EXISTS chain_bet_index');
    await client.query('COMMIT');
    console.log('[Migration] add-bolita-chain-index rollback: OK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
