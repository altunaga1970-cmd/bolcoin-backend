/**
 * Bingo Scheduler — Off-Chain Auto-Round Lifecycle
 *
 * Creates rounds automatically on a cycle:
 *   1. Create round (status=open, 45s buy window)
 *   2. Players buy cards via POST /api/bingo/buy-cards
 *   3. After 45s → close round
 *   4. Generate VRF seed (crypto.randomBytes)
 *   5. Draw 75 balls using existing resolver logic
 *   6. Detect winners, calculate prizes
 *   7. Store results, pay winners
 *   8. Wait 10s → create next round → repeat
 *
 * Only runs when:
 *   - bingo_enabled flag is true in game_config
 *   - BINGO_CONTRACT_ADDRESS is NOT set (off-chain mode)
 */

const bingoService = require('./bingoService');
const gameConfigService = require('./gameConfigService');

const BUY_WINDOW_SECONDS = 45;
const BETWEEN_ROUNDS_SECONDS = 10;

let _running = false;
let _currentRoundId = null;
let _stopRequested = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main loop: create → wait → close → resolve → repeat
 */
async function loop() {
  while (!_stopRequested) {
    try {
      // 1. Create new round
      const { roundId, scheduledClose } = await bingoService.createRoundOffChain(BUY_WINDOW_SECONDS);
      _currentRoundId = roundId;

      // 2. Wait for buy window to close
      const waitMs = Math.max(0, new Date(scheduledClose).getTime() - Date.now());
      console.log(`[BingoScheduler] Round #${roundId} open for ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);

      if (_stopRequested) break;

      // 3. Close round
      await bingoService.closeRoundOffChain(roundId);

      // Small delay before resolving (let any in-flight buys finish)
      await sleep(2000);

      if (_stopRequested) break;

      // 4. Resolve round (draw balls, detect winners, pay prizes)
      const result = await bingoService.resolveRoundOffChain(roundId);
      if (result.cancelled) {
        console.log(`[BingoScheduler] Round #${roundId} had no cards, skipping`);
      } else {
        console.log(`[BingoScheduler] Round #${roundId} resolved: line=${result.lineWinner}, bingo=${result.bingoWinner}`);
      }

      _currentRoundId = null;

      // 5. Wait between rounds
      console.log(`[BingoScheduler] Next round in ${BETWEEN_ROUNDS_SECONDS}s`);
      await sleep(BETWEEN_ROUNDS_SECONDS * 1000);

    } catch (err) {
      console.error('[BingoScheduler] Error in loop:', err.message);
      _currentRoundId = null;
      // Wait before retrying
      await sleep(10000);
    }
  }

  _running = false;
  console.log('[BingoScheduler] Stopped');
}

/**
 * Start the scheduler if bingo is enabled and we're in off-chain mode.
 */
async function start() {
  if (_running) {
    console.log('[BingoScheduler] Already running');
    return;
  }

  // Don't run if on-chain mode (contract address set)
  if (process.env.BINGO_CONTRACT_ADDRESS) {
    console.log('[BingoScheduler] On-chain mode detected, scheduler disabled');
    return;
  }

  // Check if bingo is enabled
  try {
    const enabled = await gameConfigService.getConfigValue('bingo_enabled', false);
    if (!enabled) {
      console.log('[BingoScheduler] bingo_enabled is false, scheduler not started');
      return;
    }
  } catch (err) {
    console.warn('[BingoScheduler] Could not read config, starting anyway:', err.message);
  }

  _running = true;
  _stopRequested = false;
  console.log('[BingoScheduler] Starting off-chain auto-round loop');
  // Run in background (don't await)
  loop().catch(err => {
    console.error('[BingoScheduler] Fatal error:', err);
    _running = false;
  });
}

function stop() {
  _stopRequested = true;
  console.log('[BingoScheduler] Stop requested');
}

function isRunning() {
  return _running;
}

function getCurrentRoundId() {
  return _currentRoundId;
}

module.exports = { start, stop, isRunning, getCurrentRoundId };
