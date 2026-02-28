/**
 * Bingo On-Chain Scheduler — 4-Room Staggered Round Lifecycle
 *
 * Runs when BINGO_CONTRACT_ADDRESS is set in environment.
 * Replaces the off-chain scheduler for contract-based bingo.
 *
 * Each room cycle:
 *   1. createRound()        → contract.createRound(scheduledClose)
 *   2. Wait buy window (2 min)
 *   3a. IF 0 cards sold → cancelRound() (no VRF, no LINK spent) → cooldown
 *   3b. IF cards sold  → closeAndRequestVRF() → wait VRF → draw → cooldown
 *   4. Cooldown 30s → next round
 *
 * The bingoEventService handles:
 *   - Indexing CardsPurchased events (card numbers → DB)
 *   - Auto-resolving rounds when VrfFulfilled event fires
 *   - Syncing resolution data to DB
 *
 * This scheduler only drives round creation/closing timing.
 * Resolution is event-driven (no polling needed for that step).
 */

const pool = require('../db');
const bingoService = require('./bingoService');
const gameConfigService = require('./gameConfigService');
const { getBingoContractReadOnly } = require('../chain/bingoProvider');

const NUM_ROOMS        = 4;
const BUY_WINDOW_SECONDS = 120; // 2 min buy window
const COOLDOWN_SECONDS  = 30;
const STAGGER_SECONDS   = 105; // spread 4 rooms across the buy window (~120s / 4 rooms)

// How long to wait for Chainlink VRF (real network ~120s; local mock ~instant)
const VRF_WAIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const VRF_POLL_INTERVAL_MS = 3000;           // poll DB every 3s

const BALL_INTERVAL_MS = 4500;
const LINE_PAUSE_MS    = 5000;
const BINGO_PAUSE_MS   = 6000;

let _running = false;
let _stopRequested = false;
const _roomStates = {};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Close any on-chain open rounds whose scheduled buy window has already expired.
 * Handles the case where a closeRound() tx failed in a previous cycle, leaving a
 * stale round in _openRoundIds. Without this, stale rounds accumulate until
 * MAX_OPEN_ROUNDS is hit and all createRound() calls start failing.
 */
async function closeExpiredOpenRounds() {
  let contract;
  try {
    contract = getBingoContractReadOnly();
  } catch (err) {
    console.warn('[BingoOnChainScheduler] closeExpiredOpenRounds: no contract:', err.message);
    return;
  }

  let openIds;
  try {
    openIds = await contract.getOpenRounds();
  } catch (err) {
    console.warn('[BingoOnChainScheduler] closeExpiredOpenRounds: getOpenRounds failed:', err.message);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  for (const id of openIds) {
    const roundId = Number(id);
    try {
      const info = await contract.getRoundInfo(roundId);
      if (Number(info.scheduledClose) <= now) {
        console.log(`[BingoOnChainScheduler] closeExpiredOpenRounds: closing expired round #${roundId}`);
        await bingoService.closeRound(roundId);
      }
    } catch (err) {
      console.warn(`[BingoOnChainScheduler] closeExpiredOpenRounds: round #${roundId}: ${err.message}`);
    }
  }
}

/**
 * Calculate drawing animation duration from winner ball positions.
 * Mirrors bingoScheduler.js calcDrawDurationMs.
 */
function calcDrawDurationMs(lineWinnerBall, bingoWinnerBall) {
  const ballsToDraw = bingoWinnerBall > 0 ? bingoWinnerBall : 75;
  let ms = ballsToDraw * BALL_INTERVAL_MS;
  if (lineWinnerBall  > 0) ms += LINE_PAUSE_MS;
  if (bingoWinnerBall > 0) ms += BINGO_PAUSE_MS;
  return ms;
}

/**
 * Poll DB until round reaches 'drawing' or 'resolved' status.
 * bingoEventService updates DB when VrfFulfilled fires and after resolveRound.
 *
 * Returns the resolved round row, or null on timeout.
 */
async function waitForVrfAndResolution(roundId) {
  if (!roundId || !Number.isInteger(roundId) || roundId <= 0) {
    throw new Error(`waitForVrfAndResolution: invalid roundId ${roundId}`);
  }
  const deadline = Date.now() + VRF_WAIT_TIMEOUT_MS;
  let lastLogAt = Date.now();

  while (Date.now() < deadline) {
    if (_stopRequested) return null;

    const { rows } = await pool.query(
      'SELECT status, line_winner_ball, bingo_winner_ball FROM bingo_rounds WHERE round_id = $1',
      [roundId]
    );

    if (rows.length === 0) return null;

    const { status, line_winner_ball, bingo_winner_ball } = rows[0];

    // drawing = VRF fulfilled + resolution tx submitted, prizes paid on-chain
    // resolved = finalized (after animation window)
    if (status === 'drawing' || status === 'resolved') {
      return {
        lineWinnerBall:  line_winner_ball  ? parseInt(line_winner_ball)  : 0,
        bingoWinnerBall: bingo_winner_ball ? parseInt(bingo_winner_ball) : 0,
      };
    }

    // cancelled = round had no cards; contract cancelled instead of requesting VRF
    if (status === 'cancelled') return null;

    // Periodic log so the room doesn't appear silent during long VRF waits
    if (Date.now() - lastLogAt >= 60000) {
      const elapsed = Math.round((Date.now() - (deadline - VRF_WAIT_TIMEOUT_MS)) / 1000);
      console.log(`[BingoOnChainScheduler] Round #${roundId} still waiting for VRF/resolution (${elapsed}s elapsed, status=${status})...`);
      lastLogAt = Date.now();
    }

    await sleep(VRF_POLL_INTERVAL_MS);
  }

  console.warn(`[BingoOnChainScheduler] Round #${roundId} VRF wait timeout after ${VRF_WAIT_TIMEOUT_MS / 1000}s`);
  return null;
}

/**
 * On restart the contract may already have up to MAX_OPEN_ROUNDS open.
 * Close each one (waiting for its buy-window if needed) so room loops
 * can safely call createRound() without hitting MaxOpenRoundsReached.
 *
 * Rounds are closed sequentially to avoid operator-wallet nonce conflicts.
 */
async function recoverOpenRounds() {
  let contract;
  try {
    contract = getBingoContractReadOnly();
  } catch (err) {
    console.warn('[BingoOnChainScheduler] recoverOpenRounds: contract unavailable:', err.message);
    return;
  }

  let openIds;
  try {
    openIds = await contract.getOpenRounds();
  } catch (err) {
    console.warn('[BingoOnChainScheduler] recoverOpenRounds: getOpenRounds() failed:', err.message);
    return;
  }

  if (openIds.length === 0) {
    console.log('[BingoOnChainScheduler] Recovery: no open rounds — starting fresh');
    return;
  }

  const roundIds = openIds.map(id => Number(id));
  console.log(`[BingoOnChainScheduler] Recovery: ${roundIds.length} open round(s) found: [${roundIds.join(', ')}]`);

  // Fetch scheduledClose for each round
  const tasks = await Promise.all(roundIds.map(async (roundId) => {
    try {
      const info = await contract.getRoundInfo(roundId);
      return { roundId, scheduledClose: Number(info.scheduledClose) };
    } catch (err) {
      console.warn(`[BingoOnChainScheduler] Recovery: getRoundInfo(${roundId}) failed — treating as expired`);
      return { roundId, scheduledClose: 0 };
    }
  }));

  // Sort by scheduledClose ASC so earliest-expiring rounds close first
  tasks.sort((a, b) => a.scheduledClose - b.scheduledClose);

  for (const { roundId, scheduledClose } of tasks) {
    if (_stopRequested) return;

    // Wait until the buy-window has closed (contract requires block.timestamp >= scheduledClose)
    const waitMs = Math.max(0, (scheduledClose - Math.floor(Date.now() / 1000)) * 1000);
    if (waitMs > 0) {
      console.log(`[BingoOnChainScheduler] Recovery: Round #${roundId} buy-window expires in ${Math.ceil(waitMs / 1000)}s — waiting`);
      await sleep(waitMs + 2000); // +2s buffer
    }
    if (_stopRequested) return;

    try {
      await bingoService.closeRound(roundId);
      console.log(`[BingoOnChainScheduler] Recovery: Round #${roundId} closed, awaiting VRF`);
    } catch (err) {
      console.error(`[BingoOnChainScheduler] Recovery: closeRound(${roundId}) failed:`, err.message);
      // A NONCE_EXPIRED tx may still be pending in the mempool — wait before the next
      // closeRound() so the nonce manager re-reads a settled value and doesn't collide.
      await sleep(3000);
      continue; // If already closed by another path, proceed to next
    }

    try {
      const resolution = await waitForVrfAndResolution(roundId);
      if (resolution) {
        const drawMs = calcDrawDurationMs(resolution.lineWinnerBall, resolution.bingoWinnerBall);
        await sleep(drawMs);
        await pool.query(
          `UPDATE bingo_rounds SET status = 'resolved', updated_at = NOW() WHERE round_id = $1 AND status = 'drawing'`,
          [roundId]
        );
        console.log(`[BingoOnChainScheduler] Recovery: Round #${roundId} resolved`);
      } else {
        console.log(`[BingoOnChainScheduler] Recovery: Round #${roundId} cancelled or timed out — skipping`);
      }
    } catch (err) {
      console.error(`[BingoOnChainScheduler] Recovery: waitForVrf(${roundId}) error:`, err.message);
    }
  }

  console.log('[BingoOnChainScheduler] Recovery complete — starting room loops');
}

/**
 * One room's perpetual lifecycle loop.
 */
async function roomLoop(roomNumber) {
  // Stagger start
  const staggerMs = STAGGER_SECONDS * (roomNumber - 1) * 1000;
  if (staggerMs > 0) {
    const phaseEndTime = new Date(Date.now() + staggerMs).toISOString();
    console.log(`[BingoOnChainScheduler] Room ${roomNumber} waiting ${STAGGER_SECONDS * (roomNumber - 1)}s stagger`);
    _roomStates[roomNumber] = { phase: 'waiting', roundId: null, phaseEndTime };
    await sleep(staggerMs);
  }

  while (!_stopRequested) {
    try {
      // 1. Create round on-chain
      const closesAt = Math.floor(Date.now() / 1000) + BUY_WINDOW_SECONDS;
      const { roundId, txHash } = await bingoService.createRound(closesAt);
      if (!roundId || isNaN(roundId)) {
        throw new Error(`createRound returned invalid roundId: ${roundId}`);
      }

      // Upsert the DB row with room_number directly. bingoEventService may not
      // have processed the RoundCreated log yet (polling lag up to ~5s), so we
      // can't rely on the row existing. The event service uses ON CONFLICT DO UPDATE
      // but never touches room_number, so this upsert is safe and idempotent.
      await pool.query(
        `INSERT INTO bingo_rounds (round_id, status, scheduled_close, room_number, created_at, updated_at)
         VALUES ($1, 'open', $2, $3, NOW(), NOW())
         ON CONFLICT (round_id) DO UPDATE SET room_number = $3, updated_at = NOW()`,
        [roundId, new Date(closesAt * 1000), roomNumber]
      );

      // Cancel any stale DB rounds for this room that are not the current round.
      // This cleans up off-chain rounds (high IDs from old mode) and leftover
      // open rows from previous scheduler sessions so the lobby shows the correct
      // on-chain round instead of a ghost round that doesn't exist in the contract.
      await pool.query(
        `UPDATE bingo_rounds SET status = 'cancelled', updated_at = NOW()
         WHERE room_number = $1 AND status = 'open' AND round_id != $2`,
        [roomNumber, roundId]
      );
      const scheduledClose = new Date(closesAt * 1000).toISOString();
      _roomStates[roomNumber] = {
        phase: 'buying',
        roundId,
        scheduledClose,
        phaseEndTime: scheduledClose,
      };
      console.log(`[BingoOnChainScheduler] Room ${roomNumber} Round #${roundId} open (tx: ${txHash})`);

      // 2. Wait buy window
      const waitMs = Math.max(0, closesAt * 1000 - Date.now());
      await sleep(waitMs);
      if (_stopRequested) break;

      _roomStates[roomNumber] = { ..._roomStates[roomNumber], phase: 'closing' };

      // 3. Check if anyone bought cards — skip VRF entirely for empty rounds.
      // Saves: closeAndRequestVRF() gas + Chainlink LINK + resolveRound() gas.
      // cancelRound() is the only on-chain tx needed for an empty round.
      const { rows: cardRows } = await pool.query(
        'SELECT total_cards FROM bingo_rounds WHERE round_id = $1',
        [roundId]
      );
      const totalCards = cardRows[0] ? (parseInt(cardRows[0].total_cards) || 0) : 0;

      // NOTE: the contract auto-cancels (no VRF, no LINK) when closeAndRequestVRF()
      // is called on a 0-card round. cancelRound() here saves some gas on the close
      // tx itself, but falls back to closeAndRequestVRF() if the contract rejects it
      // (e.g. cancelRound may require buy window still open on some implementations).
      let usedCancel = false;
      if (totalCards === 0) {
        console.log(`[BingoOnChainScheduler] Room ${roomNumber} Round #${roundId} — 0 cards, attempting cancelRound (no VRF)`);
        try {
          await bingoService.cancelRound(roundId);
          usedCancel = true;
          console.log(`[BingoOnChainScheduler] Room ${roomNumber} Round #${roundId} cancelled (gas saved)`);
        } catch (err) {
          console.warn(`[BingoOnChainScheduler] Room ${roomNumber} cancelRound(${roundId}) failed: ${err.message} — falling back to closeAndRequestVRF (contract will auto-cancel)`);
        }
      }

      if (!usedCancel) {
        // 3b. Cards exist (or cancelRound fallback) — close and request VRF.
        // If 0 cards: contract emits RoundCancelled automatically (no LINK spent).
        // Critical: a failed close leaves the round in _openRoundIds on-chain.
        // Retrying here (not by creating a new round) avoids stale-round accumulation.
        let closeTx;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await bingoService.closeRound(roundId);
            closeTx = result.txHash;
            break;
          } catch (err) {
            if (attempt === 3) throw err;
            console.warn(`[BingoOnChainScheduler] Room ${roomNumber} closeRound(${roundId}) attempt ${attempt} failed: ${err.message} — retrying in 5s`);
            await sleep(5000);
          }
        }
        console.log(`[BingoOnChainScheduler] Room ${roomNumber} Round #${roundId} closed + VRF requested (tx: ${closeTx})`);

        // 4. Wait for VRF fulfillment + auto-resolution (handled by bingoEventService)
        _roomStates[roomNumber] = { ..._roomStates[roomNumber], phase: 'vrf_wait' };
        console.log(`[BingoOnChainScheduler] Room ${roomNumber} Round #${roundId} waiting for VRF…`);

        const resolution = await waitForVrfAndResolution(roundId);

        if (!resolution) {
          // Timeout or stop — move to cooldown and try next round
          console.log(`[BingoOnChainScheduler] Room ${roomNumber} Round #${roundId} cancelled or timed out — skipping draw`);
        } else {
          // 5. Wait for draw animation to complete (frontend syncs to draw_started_at)
          const drawDurationMs = calcDrawDurationMs(resolution.lineWinnerBall, resolution.bingoWinnerBall);
          const drawEnd = new Date(Date.now() + drawDurationMs).toISOString();
          _roomStates[roomNumber] = { ..._roomStates[roomNumber], phase: 'drawing', phaseEndTime: drawEnd };
          console.log(`[BingoOnChainScheduler] Room ${roomNumber} Round #${roundId} drawing ${Math.ceil(drawDurationMs / 1000)}s`);

          await sleep(drawDurationMs);
          if (_stopRequested) break;

          // 6. Finalize: mark DB status=resolved (prizes already paid on-chain)
          await pool.query(
            `UPDATE bingo_rounds SET status = 'resolved', updated_at = NOW()
             WHERE round_id = $1 AND status = 'drawing'`,
            [roundId]
          );
        }
      }

      // 7. Cooldown (always — empty or not)
      const cooldownEnd = new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString();
      _roomStates[roomNumber] = { ..._roomStates[roomNumber], phase: 'results', phaseEndTime: cooldownEnd };
      console.log(`[BingoOnChainScheduler] Room ${roomNumber} cooldown ${COOLDOWN_SECONDS}s`);
      await sleep(COOLDOWN_SECONDS * 1000);

    } catch (err) {
      console.error(`[BingoOnChainScheduler] Room ${roomNumber} error:`, err.message);

      // MaxOpenRoundsReached: all 4 contract slots are full.
      // This happens when a previous closeRound() tx failed silently, leaving a stale
      // open round in _openRoundIds on-chain (the DB ghost-cleanup cancels them in DB
      // but doesn't close them on-chain). Close any expired open rounds then wait.
      const errData = (err.data || '').toString();
      const isMaxOpenRounds = err.message?.includes('MaxOpenRoundsReached')
        || err.message?.includes('25470bc4')
        || errData === '0x25470bc4'
        || errData.includes('25470bc4');

      if (isMaxOpenRounds) {
        console.log(`[BingoOnChainScheduler] Room ${roomNumber} MaxOpenRoundsReached — closing expired rounds then waiting 60s`);
        _roomStates[roomNumber] = { phase: 'waiting', roundId: null, phaseEndTime: new Date(Date.now() + 60000).toISOString() };
        try { await closeExpiredOpenRounds(); } catch (_) {}
        await sleep(60000);
      } else {
        const retryEnd = new Date(Date.now() + 10000).toISOString();
        _roomStates[roomNumber] = { phase: 'error', roundId: null, phaseEndTime: retryEnd };
        await sleep(10000);
      }
    }
  }

  console.log(`[BingoOnChainScheduler] Room ${roomNumber} stopped`);
}

/**
 * Start the on-chain scheduler.
 * Only runs when BINGO_CONTRACT_ADDRESS is configured.
 */
async function start() {
  if (_running) {
    console.log('[BingoOnChainScheduler] Already running');
    return;
  }

  if (!process.env.BINGO_CONTRACT_ADDRESS) {
    console.log('[BingoOnChainScheduler] BINGO_CONTRACT_ADDRESS not set — use off-chain scheduler instead');
    return;
  }

  try {
    const enabled = await gameConfigService.getConfigValue('bingo_enabled', false);
    if (!enabled) {
      console.log('[BingoOnChainScheduler] bingo_enabled is false, not starting');
      return;
    }
  } catch (err) {
    console.warn('[BingoOnChainScheduler] Could not read config, starting anyway:', err.message);
  }

  _running = true;
  _stopRequested = false;
  console.log(`[BingoOnChainScheduler] Starting ${NUM_ROOMS}-room on-chain scheduler (contract: ${process.env.BINGO_CONTRACT_ADDRESS})`);

  // Cancel any stale DB rounds that have no corresponding on-chain round.
  // This happens when the off-chain scheduler ran before the on-chain migration:
  // the DB has high-ID rounds (e.g. 11437) that the contract never created.
  // The lobby would show these ghost rounds, causing RoundNotFound on buyCards.
  try {
    let contract;
    try { contract = getBingoContractReadOnly(); } catch (_) { contract = null; }

    if (contract) {
      const onChainIds = await contract.getOpenRounds();
      const onChainSet = new Set(onChainIds.map(id => Number(id)));

      // Build the list of on-chain IDs we know about to exclude from cancellation.
      // Any DB round that is 'open' but not in the contract's open list is a ghost.
      const { rows: dbOpenRows } = await pool.query(
        `SELECT round_id FROM bingo_rounds WHERE status = 'open'`
      );
      const ghostIds = dbOpenRows
        .map(r => r.round_id)
        .filter(id => !onChainSet.has(id));

      if (ghostIds.length > 0) {
        await pool.query(
          `UPDATE bingo_rounds SET status = 'cancelled', updated_at = NOW()
           WHERE round_id = ANY($1)`,
          [ghostIds]
        );
        console.log(`[BingoOnChainScheduler] Startup: cancelled ${ghostIds.length} ghost DB round(s): [${ghostIds.join(', ')}]`);
      } else {
        console.log('[BingoOnChainScheduler] Startup: no ghost rounds in DB');
      }
    }
  } catch (err) {
    console.warn('[BingoOnChainScheduler] Startup ghost-round cleanup failed (non-fatal):', err.message);
  }

  // Close any open rounds left over from a previous session before creating new ones.
  // This prevents MaxOpenRoundsReached() on restart.
  await recoverOpenRounds();
  if (_stopRequested) { _running = false; return; }

  for (let room = 1; room <= NUM_ROOMS; room++) {
    _roomStates[room] = { phase: 'starting', roundId: null };
    roomLoop(room).catch(err => {
      console.error(`[BingoOnChainScheduler] Room ${room} fatal:`, err);
    });
  }
}

function stop() {
  _stopRequested = true;
  console.log('[BingoOnChainScheduler] Stop requested');
}

function isRunning() { return _running; }

function getRoomStates() { return { ..._roomStates }; }

module.exports = { start, stop, isRunning, getRoomStates };
