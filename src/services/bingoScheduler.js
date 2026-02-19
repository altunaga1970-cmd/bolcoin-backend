/**
 * Bingo Scheduler — 4-Room Staggered Auto-Round Lifecycle
 *
 * Runs 4 parallel room loops with staggered timing:
 *   Room 1 starts immediately, Room 2 after ~103s, Room 3 after ~206s, Room 4 after ~309s.
 *
 * Each room cycle:
 *   1. Create round (status=open, 45s buy window)
 *   2. Players buy cards via POST /api/bingo/buy-cards
 *   3. After 45s → close round
 *   4. Generate VRF seed, draw 75 balls, detect winners, pay prizes
 *   5. Wait 30s cooldown → create next round → repeat
 *
 * Only runs when:
 *   - bingo_enabled flag is true in game_config
 *   - BINGO_CONTRACT_ADDRESS is NOT set (off-chain mode)
 */

const bingoService = require('./bingoService');
const gameConfigService = require('./gameConfigService');

const NUM_ROOMS = 4;
const BUY_WINDOW_SECONDS = 45;
const COOLDOWN_SECONDS = 30;
const STAGGER_SECONDS = 103; // ~7min cycle / 4 rooms

let _running = false;
let _stopRequested = false;

// Per-room state
const _roomStates = {};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate total drawing duration in ms for a resolved round.
 * Mirrors the logic in roomLoop so the scheduler and recovery use the same timing.
 */
function calcDrawDurationMs(lineWinnerBall, bingoWinnerBall) {
  const BALL_INTERVAL_MS = 4500;
  const LINE_PAUSE_MS    = 5000;
  const BINGO_PAUSE_MS   = 6000;
  const ballsToDraw = bingoWinnerBall > 0 ? bingoWinnerBall : 75;
  let ms = ballsToDraw * BALL_INTERVAL_MS;
  if (lineWinnerBall  > 0) ms += LINE_PAUSE_MS;
  if (bingoWinnerBall > 0) ms += BINGO_PAUSE_MS;
  return ms;
}

/**
 * Recover rounds left in intermediate states by a previous server crash/restart.
 *
 * Three cases handled:
 *  1. status='drawing'   → calculate remaining animation time, finalize when it elapses
 *                          (or immediately if the animation window has already passed)
 *  2. status='closed'    → VRF never ran; resolve now, then schedule finalize
 *  3. status='open' + scheduled_close in the past → close, resolve, schedule finalize
 */
async function recoverOrphanRounds() {
  let orphans;
  try {
    orphans = await bingoService.getOrphanRounds();
  } catch (err) {
    console.error('[BingoScheduler] Could not query orphan rounds:', err.message);
    return;
  }

  const { drawing, closed, staleOpen } = orphans;
  const total = drawing.length + closed.length + staleOpen.length;

  if (total === 0) {
    console.log('[BingoScheduler] No orphan rounds found');
    return;
  }

  console.log(`[BingoScheduler] Recovering ${drawing.length} drawing, ${closed.length} closed, ${staleOpen.length} stale-open orphan round(s)`);

  // --- 1. Drawing rounds ---
  for (const row of drawing) {
    const lineWinnerBall  = row.line_winner_ball  ? parseInt(row.line_winner_ball)  : 0;
    const bingoWinnerBall = row.bingo_winner_ball ? parseInt(row.bingo_winner_ball) : 0;
    const drawDurationMs  = calcDrawDurationMs(lineWinnerBall, bingoWinnerBall);
    const drawStartMs     = new Date(row.draw_started_at).getTime();
    const remainingMs     = (drawStartMs + drawDurationMs) - Date.now();

    if (remainingMs <= 0) {
      // Animation window already past — finalize immediately
      try {
        await bingoService.finalizeDrawing(row.round_id);
        console.log(`[BingoScheduler] Orphan drawing round #${row.round_id} (room ${row.room_number}) finalized immediately`);
      } catch (err) {
        console.error(`[BingoScheduler] Error finalizing drawing round #${row.round_id}:`, err.message);
      }
    } else {
      // Animation still in progress — wait for it to finish
      console.log(`[BingoScheduler] Orphan drawing round #${row.round_id} (room ${row.room_number}) resuming — finalizing in ${Math.ceil(remainingMs / 1000)}s`);
      const roundId = row.round_id;
      setTimeout(async () => {
        try {
          await bingoService.finalizeDrawing(roundId);
          console.log(`[BingoScheduler] Orphan drawing round #${roundId} finalized after resume delay`);
        } catch (err) {
          console.error(`[BingoScheduler] Error finalizing resumed round #${roundId}:`, err.message);
        }
      }, remainingMs);
    }
  }

  // --- 2. Closed rounds (VRF never ran) ---
  for (const row of closed) {
    try {
      const result = await bingoService.resolveRoundOffChain(row.round_id);
      if (result.cancelled) {
        console.log(`[BingoScheduler] Orphan closed round #${row.round_id} had no cards, cancelled`);
        continue;
      }
      const drawDurationMs = calcDrawDurationMs(result.lineWinnerBall, result.bingoWinnerBall);
      const roundId = row.round_id;
      setTimeout(async () => {
        try {
          await bingoService.finalizeDrawing(roundId);
          console.log(`[BingoScheduler] Orphan closed round #${roundId} finalized after draw`);
        } catch (err) {
          console.error(`[BingoScheduler] Error finalizing recovered closed round #${roundId}:`, err.message);
        }
      }, drawDurationMs);
      console.log(`[BingoScheduler] Orphan closed round #${row.round_id} (room ${row.room_number}) resolved — finalizing in ${Math.ceil(drawDurationMs / 1000)}s`);
    } catch (err) {
      console.error(`[BingoScheduler] Error recovering closed round #${row.round_id}:`, err.message);
    }
  }

  // --- 3. Stale open rounds (buy window expired without being closed) ---
  for (const row of staleOpen) {
    try {
      await bingoService.closeRoundOffChain(row.round_id);
      const result = await bingoService.resolveRoundOffChain(row.round_id);
      if (result.cancelled) {
        console.log(`[BingoScheduler] Orphan stale-open round #${row.round_id} had no cards, cancelled`);
        continue;
      }
      const drawDurationMs = calcDrawDurationMs(result.lineWinnerBall, result.bingoWinnerBall);
      const roundId = row.round_id;
      setTimeout(async () => {
        try {
          await bingoService.finalizeDrawing(roundId);
          console.log(`[BingoScheduler] Orphan stale-open round #${roundId} finalized after draw`);
        } catch (err) {
          console.error(`[BingoScheduler] Error finalizing recovered stale-open round #${roundId}:`, err.message);
        }
      }, drawDurationMs);
      console.log(`[BingoScheduler] Orphan stale-open round #${row.round_id} (room ${row.room_number}) closed+resolved — finalizing in ${Math.ceil(drawDurationMs / 1000)}s`);
    } catch (err) {
      console.error(`[BingoScheduler] Error recovering stale-open round #${row.round_id}:`, err.message);
    }
  }
}

/**
 * Room loop: create → wait buy window → close → resolve → cooldown → repeat
 */
async function roomLoop(roomNumber) {
  // Stagger start
  const staggerMs = STAGGER_SECONDS * (roomNumber - 1) * 1000;
  if (staggerMs > 0) {
    const staggerEnd = new Date(Date.now() + staggerMs).toISOString();
    console.log(`[BingoScheduler] Room ${roomNumber} waiting ${STAGGER_SECONDS * (roomNumber - 1)}s stagger`);
    _roomStates[roomNumber] = { phase: 'waiting', roundId: null, scheduledClose: null, phaseEndTime: staggerEnd };
    await sleep(staggerMs);
  }

  while (!_stopRequested) {
    try {
      // 1. Create new round
      const { roundId, scheduledClose } = await bingoService.createRoundOffChain(BUY_WINDOW_SECONDS, roomNumber);
      _roomStates[roomNumber] = {
        phase: 'buying',
        roundId,
        scheduledClose: scheduledClose.toISOString(),
        phaseEndTime: scheduledClose.toISOString(),
      };

      // 2. Wait for buy window to close
      const waitMs = Math.max(0, new Date(scheduledClose).getTime() - Date.now());
      console.log(`[BingoScheduler] Room ${roomNumber} Round #${roundId} open for ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);

      if (_stopRequested) break;

      // 3. Close round
      await bingoService.closeRoundOffChain(roundId);
      // Brief resolving phase while VRF + ball generation runs
      _roomStates[roomNumber] = { ..._roomStates[roomNumber], phase: 'resolving' };

      // Small delay before resolving (let in-flight buys finish)
      await sleep(2000);

      if (_stopRequested) break;

      // 4. Resolve round → status='drawing', draw_started_at=NOW()
      const result = await bingoService.resolveRoundOffChain(roundId);
      if (result.cancelled) {
        console.log(`[BingoScheduler] Room ${roomNumber} Round #${roundId} had no cards, skipping`);
      } else {
        console.log(`[BingoScheduler] Room ${roomNumber} Round #${roundId} drawing: line=${result.lineWinners?.length || 0} winner(s), bingo=${result.bingoWinners?.length || 0} winner(s)`);

        // 5. Wait for drawing animation to complete
        // Duration = balls_to_draw * 4500ms + pauses (5s line + 6s bingo)
        const BALL_INTERVAL_MS = 4500;
        const LINE_PAUSE_MS = 5000;
        const BINGO_PAUSE_MS = 6000;
        const ballsToDraw = result.bingoWinnerBall > 0 ? result.bingoWinnerBall : 75;
        let drawDurationMs = ballsToDraw * BALL_INTERVAL_MS;
        if (result.lineWinnerBall > 0) drawDurationMs += LINE_PAUSE_MS;
        if (result.bingoWinnerBall > 0) drawDurationMs += BINGO_PAUSE_MS;

        const drawEnd = new Date(Date.now() + drawDurationMs).toISOString();
        _roomStates[roomNumber] = { ..._roomStates[roomNumber], phase: 'drawing', phaseEndTime: drawEnd };
        console.log(`[BingoScheduler] Room ${roomNumber} drawing for ${Math.ceil(drawDurationMs / 1000)}s (${ballsToDraw} balls)`);

        await sleep(drawDurationMs);
        if (_stopRequested) break;

        // 6. Finalize: drawing → resolved
        await bingoService.finalizeDrawing(roundId);
      }

      // 7. Results/cooldown phase
      const cooldownEnd = new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString();
      _roomStates[roomNumber] = { ..._roomStates[roomNumber], phase: 'results', phaseEndTime: cooldownEnd };
      console.log(`[BingoScheduler] Room ${roomNumber} cooldown ${COOLDOWN_SECONDS}s`);
      await sleep(COOLDOWN_SECONDS * 1000);

    } catch (err) {
      console.error(`[BingoScheduler] Room ${roomNumber} error:`, err.message);
      const retryEnd = new Date(Date.now() + 10000).toISOString();
      _roomStates[roomNumber] = { phase: 'error', roundId: null, scheduledClose: null, phaseEndTime: retryEnd };
      await sleep(10000);
    }
  }

  console.log(`[BingoScheduler] Room ${roomNumber} stopped`);
}

/**
 * Start the scheduler: launches 4 parallel room loops.
 */
async function start() {
  if (_running) {
    console.log('[BingoScheduler] Already running');
    return;
  }

  if (process.env.BINGO_CONTRACT_ADDRESS) {
    console.log('[BingoScheduler] On-chain mode detected, scheduler disabled');
    return;
  }

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
  console.log(`[BingoScheduler] Starting ${NUM_ROOMS}-room staggered scheduler`);

  // Recover any rounds left in intermediate states from a previous crash/restart
  await recoverOrphanRounds();

  // Launch all room loops in parallel
  for (let room = 1; room <= NUM_ROOMS; room++) {
    _roomStates[room] = { phase: 'starting', roundId: null, scheduledClose: null };
    roomLoop(room).catch(err => {
      console.error(`[BingoScheduler] Room ${room} fatal error:`, err);
    });
  }
}

function stop() {
  _stopRequested = true;
  console.log('[BingoScheduler] Stop requested for all rooms');
}

function isRunning() {
  return _running;
}

function getCurrentRoundId() {
  // Return first room's roundId for backwards compat
  return _roomStates[1]?.roundId || null;
}

/**
 * Get state of all rooms.
 * @returns {Object} { 1: { phase, roundId, scheduledClose }, 2: {...}, ... }
 */
function getRoomStates() {
  return { ..._roomStates };
}

module.exports = { start, stop, isRunning, getCurrentRoundId, getRoomStates };
