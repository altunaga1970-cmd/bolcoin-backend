/**
 * One-time backfill script: index all historical La Bolita events
 * (DrawCreated, BetPlaced, BetResolved, DrawResolved) into draws + bets tables.
 *
 * Run this after the indexer was deployed to catch events missed before it started.
 *
 * Usage:
 *   node scripts/backfill-bolita-history.js
 *   node scripts/backfill-bolita-history.js 12345678   (from specific block)
 *
 * Requires env vars: BOLITA_CONTRACT_ADDRESS, RPC_URL (or POLYGON_RPC_URL), DATABASE_URL
 */

require('dotenv').config();
const { bolitaIndexer } = require('../src/services/bolitaIndexer');

const fromBlock = parseInt(process.argv[2] || '0', 10);

async function main() {
  console.log(`Backfilling La Bolita on-chain history from block ${fromBlock}...`);
  await bolitaIndexer.backfill(fromBlock);
  process.exit(0);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
