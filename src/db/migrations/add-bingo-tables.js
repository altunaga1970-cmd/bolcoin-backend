/**
 * Migration: Add Bingo Tables
 *
 * Tables: bingo_rounds, bingo_cards, bingo_results, bingo_pool
 * Config entries for bingo game parameters
 */

const { pool } = require('../../config/database');

async function up() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // bingo_rounds
    await client.query(`
      CREATE TABLE IF NOT EXISTS bingo_rounds (
        id SERIAL PRIMARY KEY,
        round_id INTEGER UNIQUE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        scheduled_close TIMESTAMP,
        total_cards INTEGER DEFAULT 0,
        total_revenue NUMERIC(18, 6) DEFAULT 0,
        vrf_random_word TEXT,
        line_winner VARCHAR(42),
        bingo_winner VARCHAR(42),
        drawn_balls JSONB,
        resolution_tx VARCHAR(66),
        fee_amount NUMERIC(18, 6) DEFAULT 0,
        reserve_amount NUMERIC(18, 6) DEFAULT 0,
        line_prize NUMERIC(18, 6) DEFAULT 0,
        bingo_prize NUMERIC(18, 6) DEFAULT 0,
        jackpot_won BOOLEAN DEFAULT false,
        jackpot_paid NUMERIC(18, 6) DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // bingo_cards
    await client.query(`
      CREATE TABLE IF NOT EXISTS bingo_cards (
        id SERIAL PRIMARY KEY,
        card_id INTEGER UNIQUE NOT NULL,
        round_id INTEGER NOT NULL,
        owner_address VARCHAR(42) NOT NULL,
        card_index INTEGER NOT NULL,
        numbers JSONB NOT NULL,
        line_hit_ball INTEGER,
        bingo_hit_ball INTEGER,
        is_line_winner BOOLEAN DEFAULT false,
        is_bingo_winner BOOLEAN DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // bingo_results
    await client.query(`
      CREATE TABLE IF NOT EXISTS bingo_results (
        id SERIAL PRIMARY KEY,
        round_id INTEGER UNIQUE NOT NULL,
        vrf_seed TEXT NOT NULL,
        drawn_balls JSONB NOT NULL,
        line_winner_card_id INTEGER,
        bingo_winner_card_id INTEGER,
        resolution_time_ms INTEGER,
        operator_signature TEXT,
        tx_hash VARCHAR(66),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // bingo_pool (single row, id=1)
    await client.query(`
      CREATE TABLE IF NOT EXISTS bingo_pool (
        id INTEGER PRIMARY KEY DEFAULT 1,
        contract_address VARCHAR(42),
        jackpot_balance NUMERIC(18, 6) DEFAULT 0,
        accrued_fees NUMERIC(18, 6) DEFAULT 0,
        total_rounds INTEGER DEFAULT 0,
        total_cards_sold INTEGER DEFAULT 0,
        total_revenue NUMERIC(18, 6) DEFAULT 0,
        total_payouts NUMERIC(18, 6) DEFAULT 0,
        last_synced_block INTEGER DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Insert default bingo_pool row
    await client.query(`
      INSERT INTO bingo_pool (id, contract_address)
      VALUES (1, NULL)
      ON CONFLICT (id) DO NOTHING
    `);

    // Indices
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bingo_rounds_status ON bingo_rounds(status);
      CREATE INDEX IF NOT EXISTS idx_bingo_rounds_round_id ON bingo_rounds(round_id);
      CREATE INDEX IF NOT EXISTS idx_bingo_cards_round_id ON bingo_cards(round_id);
      CREATE INDEX IF NOT EXISTS idx_bingo_cards_owner ON bingo_cards(owner_address);
      CREATE INDEX IF NOT EXISTS idx_bingo_cards_card_id ON bingo_cards(card_id);
      CREATE INDEX IF NOT EXISTS idx_bingo_results_round_id ON bingo_results(round_id);
    `);

    // Game config entries
    const configEntries = [
      ['bingo_enabled', 'false', 'boolean'],
      ['bingo_card_price', '1', 'number'],
      ['bingo_fee_bps', '1000', 'number'],
      ['bingo_reserve_bps', '1000', 'number'],
      ['bingo_line_prize_bps', '1000', 'number'],
      ['bingo_bingo_prize_bps', '7000', 'number'],
      ['bingo_jackpot_ball_threshold', '25', 'number'],
      ['bingo_max_cards_per_user', '4', 'number'],
      ['bingo_auto_resolve_enabled', 'true', 'boolean'],
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
    console.log('[Migration] Bingo tables migration applied successfully');
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
    await client.query('DROP TABLE IF EXISTS bingo_results CASCADE');
    await client.query('DROP TABLE IF EXISTS bingo_cards CASCADE');
    await client.query('DROP TABLE IF EXISTS bingo_rounds CASCADE');
    await client.query('DROP TABLE IF EXISTS bingo_pool CASCADE');
    await client.query(`
      DELETE FROM game_config WHERE key LIKE 'bingo_%'
    `);
    await client.query('COMMIT');
    console.log('[Migration] Bingo tables rollback complete');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
