/**
 * One-time backfill script: index all historical Keno BetResolved events
 * into the keno_games table so past on-chain games appear in history.
 *
 * Usage:
 *   node scripts/backfill-keno-history.js
 *   node scripts/backfill-keno-history.js 12345678   (from specific block)
 *
 * Requires env vars: KENO_CONTRACT_ADDRESS, RPC_URL (or POLYGON_RPC_URL), DATABASE_URL
 */

require('dotenv').config();
const { kenoIndexer } = require('../src/services/kenoIndexer');

const fromBlock = parseInt(process.argv[2] || '0', 10);

async function main() {
  console.log(`Backfilling Keno on-chain history from block ${fromBlock}...`);
  await kenoIndexer.backfill(fromBlock);
  process.exit(0);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
