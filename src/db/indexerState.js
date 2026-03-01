/**
 * Indexer State — DB persistence for lastBlockProcessed
 *
 * Stores the last confirmed block processed by each indexer so that
 * after a Railway deploy (or any process restart), the indexer resumes
 * from where it left off instead of the current chain tip — preventing
 * a gap where BetResolved / DrawResolved events are missed.
 *
 * Table: indexer_state (created in init.js runBaseSchema)
 */

const { query } = require('../config/database');

/**
 * Load the last processed block for a named indexer.
 * Returns null if no state exists yet.
 */
async function loadIndexerBlock(name) {
    try {
        const res = await query(
            'SELECT last_block FROM indexer_state WHERE name = $1',
            [name]
        );
        if (res.rows.length > 0) {
            return Number(res.rows[0].last_block);
        }
        return null;
    } catch (err) {
        console.error(`[IndexerState] Failed to load block for ${name}:`, err.message);
        return null;
    }
}

/**
 * Persist the last processed block for a named indexer.
 * Upserts so it works on first call and subsequent updates.
 */
async function saveIndexerBlock(name, block) {
    try {
        await query(
            `INSERT INTO indexer_state (name, last_block, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (name) DO UPDATE SET last_block = $2, updated_at = NOW()`,
            [name, block]
        );
    } catch (err) {
        // Non-fatal — next poll will retry
        console.error(`[IndexerState] Failed to save block for ${name}:`, err.message);
    }
}

module.exports = { loadIndexerBlock, saveIndexerBlock };
