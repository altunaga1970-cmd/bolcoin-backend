/**
 * La Bolita Draw Scheduler
 *
 * Manages the full lifecycle of LaBolitaGame.sol draws:
 *   1. createDraw() + openDraw()  — at (scheduledClose - OPEN_BEFORE_MIN)
 *   2. closeDraw()                — at scheduledClose → requests Chainlink VRF
 *   3. resolveDrawBatch()         — if draw has >100 bets (paged resolution)
 *   4. cancelStaleDraw()          — if VRF times out after 2 hours
 *
 * Draw times come from BOLITA_DRAW_TIMES env var (UTC, e.g. "10:00,15:00,21:00").
 * Each time slot maps to a daily draw. The draw number format is YYYYMMDD-HHMM.
 *
 * Resolution for ≤100 bets is handled automatically by the contract's VRF callback.
 * The bolitaIndexer event service handles DB updates via on-chain events.
 * This scheduler handles only the operator-side contract calls.
 *
 * Environment variables:
 *   BOLITA_DRAW_TIMES      — Comma-separated UTC times (default: "10:00,15:00,21:00")
 *   BOLITA_OPEN_BEFORE_MIN — Minutes before close to open draw (default: 60)
 *   BOLITA_CONTRACT_ADDRESS — Required. If absent, scheduler does not start.
 */

const pool = require('../db');
const {
  getBolitaContract,
  AMOY_GAS_OVERRIDES,
  resetNonceManager,
  isNonceError,
} = require('../chain/bolitaProvider');

// ── Constants ──────────────────────────────────────────────────────────────

// VRF timeout in the contract is 2 hours. We wait 2hr 5min before cancelling.
const VRF_STALE_MINUTES = 125;

// Max bets per resolveDrawBatch() call (matches MAX_BETS_PER_RESOLVE in contract)
const RESOLVE_BATCH_SIZE = 100;

// How often the scheduler polls for work
const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

// ── State ──────────────────────────────────────────────────────────────────

let _pollTimer = null;
let _running   = false;
let _stopRequested = false;

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse BOLITA_DRAW_TIMES into an array of { hour, minute }.
 * Input:  "10:00,15:00,21:00"
 * Output: [{ hour: 10, minute: 0 }, { hour: 15, minute: 0 }, { hour: 21, minute: 0 }]
 */
function parseDrawTimes() {
  const raw = process.env.BOLITA_DRAW_TIMES || '10:00,15:00,21:00';
  return raw.split(',').map(t => {
    const [h, m] = t.trim().split(':').map(Number);
    return { hour: h || 0, minute: m || 0 };
  }).filter(({ hour, minute }) =>
    Number.isFinite(hour) && Number.isFinite(minute) &&
    hour >= 0 && hour < 24 && minute >= 0 && minute < 60
  );
}

/**
 * Minutes before scheduledClose to open the draw.
 */
function openBeforeMs() {
  // Default: 24h (1440 min) — ensures all 3 daily draws are always open
  // simultaneously so users can always see and bet on the next 3 draws.
  // Override via BOLITA_OPEN_BEFORE_MIN env var.
  const min = parseInt(process.env.BOLITA_OPEN_BEFORE_MIN) || 1440;
  return Math.max(5, min) * 60 * 1000;
}

/**
 * Draw number string: YYYYMMDD-HHMM (UTC).
 * e.g., 2026-02-28 10:00 UTC → "20260228-1000"
 */
function drawNumber(closeUtc) {
  const y  = closeUtc.getUTCFullYear();
  const mo = String(closeUtc.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(closeUtc.getUTCDate()).padStart(2, '0');
  const h  = String(closeUtc.getUTCHours()).padStart(2, '0');
  const mi = String(closeUtc.getUTCMinutes()).padStart(2, '0');
  return `${y}${mo}${d}-${h}${mi}`;
}

/**
 * All draw time slots in the next 72 hours, ordered by scheduledClose asc.
 * Horizon is 72h so that with a 24h open window all 3 upcoming draws are
 * always found and created in advance.
 * Each slot has: { drawNum, scheduledCloseUnix, openAtMs }
 */
function upcomingSlots() {
  const times    = parseDrawTimes();
  const obMs     = openBeforeMs();
  const now      = Date.now();
  const horizon  = now + 72 * 60 * 60 * 1000;
  const slots    = [];

  for (let dayOffset = -1; dayOffset <= 3; dayOffset++) {
    for (const { hour, minute } of times) {
      const d = new Date(now);
      d.setUTCHours(hour, minute, 0, 0);
      d.setUTCDate(d.getUTCDate() + dayOffset);

      const closeMs = d.getTime();
      // Skip draws that are already past (or <5min left — too late to open)
      if (closeMs <= now + 5 * 60 * 1000) continue;
      // Skip draws beyond the 48h horizon
      if (closeMs > horizon) continue;

      slots.push({
        drawNum:            drawNumber(d),
        scheduledCloseUnix: Math.floor(closeMs / 1000),
        openAtMs:           closeMs - obMs,
      });
    }
  }

  slots.sort((a, b) => a.scheduledCloseUnix - b.scheduledCloseUnix);
  return slots;
}

// ── Contract call wrappers ─────────────────────────────────────────────────

/**
 * Send a transaction with nonce-error retry.
 */
async function sendTx(fn) {
  try {
    return await fn();
  } catch (err) {
    if (isNonceError(err)) {
      console.warn('[BolitaScheduler] Nonce error — resetting NonceManager and retrying');
      resetNonceManager();
      return await fn();
    }
    throw err;
  }
}

// ── Scheduler steps ────────────────────────────────────────────────────────

/**
 * Create and open a draw on-chain, then upsert into DB.
 * Extracts drawId from the DrawCreated event in the tx receipt.
 */
async function _createAndOpen(num, scheduledCloseUnix) {
  const contract = getBolitaContract();

  // Step 1: createDraw
  const createReceipt = await sendTx(() =>
    contract.createDraw(num, scheduledCloseUnix, AMOY_GAS_OVERRIDES).then(tx => tx.wait())
  );

  // Parse drawId from DrawCreated event
  let drawId = null;
  for (const log of createReceipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === 'DrawCreated') {
        drawId = Number(parsed.args.drawId);
        break;
      }
    } catch (_) {}
  }

  if (!drawId) {
    console.error(`[BolitaScheduler] createDraw "${num}" — DrawCreated event not found in receipt`);
    return null;
  }

  // Upsert into DB — indexer will also do this via event (ON CONFLICT is safe)
  const scheduledClose = new Date(scheduledCloseUnix * 1000);
  await pool.query(
    `INSERT INTO draws (id, draw_number, draw_type, scheduled_time, status, created_at, updated_at)
     VALUES ($1, $2, 'bolita', $3, 'scheduled', NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       draw_number = $2, scheduled_time = $3, updated_at = NOW()`,
    [drawId, num, scheduledClose]
  );
  console.log(`[BolitaScheduler] Draw #${drawId} "${num}" created (tx: ${createReceipt.hash})`);

  // Step 2: openDraw
  try {
    await sendTx(() =>
      contract.openDraw(drawId, AMOY_GAS_OVERRIDES).then(tx => tx.wait())
    );
    await pool.query(
      `UPDATE draws SET status = 'open', updated_at = NOW() WHERE id = $1`,
      [drawId]
    );
    console.log(`[BolitaScheduler] Draw #${drawId} "${num}" open — accepting bets until ${scheduledClose.toISOString()}`);
  } catch (err) {
    console.error(`[BolitaScheduler] openDraw(${drawId}) failed: ${err.message} — draw stays in 'scheduled'`);
  }

  return drawId;
}

/**
 * Step 1 — Ensure all draw slots whose open window has arrived exist in DB.
 * Creates draws that are missing (i.e., no DB row with that draw_number).
 */
async function _ensureDrawsExist() {
  const slots = upcomingSlots();
  const now   = Date.now();

  for (const slot of slots) {
    if (_stopRequested) return;

    // Create only when the "open window" has arrived (openAtMs <= now)
    if (now < slot.openAtMs) continue;

    // Check if already in DB (by draw_number — unique across all draws)
    const { rows } = await pool.query(
      `SELECT id FROM draws WHERE draw_number = $1`,
      [slot.drawNum]
    );
    if (rows.length > 0) continue;

    console.log(`[BolitaScheduler] Creating draw "${slot.drawNum}" (closes ${new Date(slot.scheduledCloseUnix * 1000).toISOString()})`);
    try {
      await _createAndOpen(slot.drawNum, slot.scheduledCloseUnix);
    } catch (err) {
      console.error(`[BolitaScheduler] Failed to create "${slot.drawNum}": ${err.message}`);
    }
  }
}

/**
 * Step 2 — Open any draws stuck in 'scheduled' status (openDraw failed previously).
 */
async function _openStuckScheduledDraws() {
  const { rows } = await pool.query(
    `SELECT id, draw_number FROM draws WHERE draw_type = 'bolita' AND status = 'scheduled'`
  );
  for (const draw of rows) {
    if (_stopRequested) return;
    console.log(`[BolitaScheduler] Opening stuck scheduled draw #${draw.id} "${draw.draw_number}"`);
    try {
      const contract = getBolitaContract();
      await sendTx(() =>
        contract.openDraw(draw.id, AMOY_GAS_OVERRIDES).then(tx => tx.wait())
      );
      await pool.query(
        `UPDATE draws SET status = 'open', updated_at = NOW() WHERE id = $1`,
        [draw.id]
      );
      console.log(`[BolitaScheduler] Draw #${draw.id} opened`);
    } catch (err) {
      console.error(`[BolitaScheduler] openDraw(${draw.id}) failed: ${err.message}`);
    }
  }
}

/**
 * Step 3 — Close OPEN draws whose scheduled_time has passed.
 * Calls closeDraw() → contract requests Chainlink VRF.
 */
async function _closeExpiredDraws() {
  const { rows } = await pool.query(
    `SELECT id, draw_number FROM draws
     WHERE draw_type = 'bolita' AND status = 'open' AND scheduled_time <= NOW()
     ORDER BY scheduled_time ASC`
  );
  for (const draw of rows) {
    if (_stopRequested) return;
    console.log(`[BolitaScheduler] Closing draw #${draw.id} "${draw.draw_number}" — requesting VRF`);
    try {
      const contract = getBolitaContract();
      await sendTx(() =>
        contract.closeDraw(draw.id, AMOY_GAS_OVERRIDES).then(tx => tx.wait())
      );
      await pool.query(
        `UPDATE draws SET status = 'vrf_pending', updated_at = NOW() WHERE id = $1`,
        [draw.id]
      );
      console.log(`[BolitaScheduler] Draw #${draw.id} closed — VRF requested`);
    } catch (err) {
      console.error(`[BolitaScheduler] closeDraw(${draw.id}) failed: ${err.message}`);
    }
  }
}

/**
 * Step 4 — Resolve draws where VRF has fulfilled but >100 bets need paged resolution.
 *
 * Detection: status = 'vrf_pending' AND winning_parles IS NOT NULL
 * (winning_parles is set by the indexer when WinningNumberSet event fires,
 *  but DrawResolved hasn't fired yet — meaning >100 bets need resolveDrawBatch())
 *
 * For ≤100 bets: the contract auto-resolves in the VRF callback → DrawResolved fires
 * → indexer marks 'completed'. This function only runs for the >100-bets case.
 */
async function _resolveBatchDraws() {
  const { rows } = await pool.query(
    `SELECT id, draw_number FROM draws
     WHERE draw_type = 'bolita'
       AND status = 'vrf_pending'
       AND winning_parles IS NOT NULL
     ORDER BY id ASC`
  );
  for (const draw of rows) {
    if (_stopRequested) return;
    console.log(`[BolitaScheduler] Draw #${draw.id} — VRF fulfilled, calling resolveDrawBatch`);
    try {
      const contract = getBolitaContract();
      await sendTx(() =>
        contract.resolveDrawBatch(draw.id, RESOLVE_BATCH_SIZE, AMOY_GAS_OVERRIDES).then(tx => tx.wait())
      );
      console.log(`[BolitaScheduler] Draw #${draw.id} resolveDrawBatch sent — indexer will update status`);
    } catch (err) {
      // If the draw is already fully resolved the call may revert — that's fine.
      // The indexer will eventually mark it 'completed' via DrawResolved event.
      console.warn(`[BolitaScheduler] resolveDrawBatch(${draw.id}): ${err.message}`);
    }
  }
}

/**
 * Step 5 — Cancel draws stuck in 'vrf_pending' for too long (VRF timeout).
 * The contract's VRF_TIMEOUT is 2 hours; we allow an extra 5 minutes.
 */
async function _cancelStaleDraws() {
  const { rows } = await pool.query(
    `SELECT id, draw_number FROM draws
     WHERE draw_type = 'bolita'
       AND status = 'vrf_pending'
       AND winning_parles IS NULL
       AND updated_at < NOW() - ($1 * INTERVAL '1 minute')`,
    [VRF_STALE_MINUTES]
  );
  for (const draw of rows) {
    if (_stopRequested) return;
    console.log(`[BolitaScheduler] Draw #${draw.id} "${draw.draw_number}" VRF stale (>${VRF_STALE_MINUTES}min) — cancelling`);
    try {
      const contract = getBolitaContract();
      await sendTx(() =>
        contract.cancelStaleDraw(draw.id, AMOY_GAS_OVERRIDES).then(tx => tx.wait())
      );
      await pool.query(
        `UPDATE draws SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [draw.id]
      );
      console.log(`[BolitaScheduler] Draw #${draw.id} stale-VRF cancelled`);
    } catch (err) {
      console.error(`[BolitaScheduler] cancelStaleDraw(${draw.id}) failed: ${err.message}`);
    }
  }
}

// ── Poll tick ──────────────────────────────────────────────────────────────

async function _tick() {
  if (!_running || _stopRequested) return;

  try {
    await _ensureDrawsExist();
    await _openStuckScheduledDraws();
    await _closeExpiredDraws();
    await _resolveBatchDraws();
    await _cancelStaleDraws();
  } catch (err) {
    console.error('[BolitaScheduler] Poll tick error:', err.message);
  }

  if (!_stopRequested) {
    _pollTimer = setTimeout(_tick, POLL_INTERVAL_MS);
  }
}

// ── Startup cleanup ────────────────────────────────────────────────────────

/**
 * Remove bolita draws that exist in DB but NOT on-chain.
 * These are "orphan" draws created by the old off-chain scheduler before
 * bolitaDrawScheduler was activated. They have DB IDs that don't correspond
 * to any contract draw, so contract.closeDraw(id) would revert forever.
 *
 * We identify orphans by calling contract.draws(id): if draw.id === 0,
 * the draw doesn't exist on-chain and should be removed from DB so that
 * bolitaDrawScheduler can recreate them properly (DB + contract).
 */
async function _cleanupOrphanDraws() {
  const { rows } = await pool.query(
    `SELECT id, draw_number FROM draws
     WHERE draw_type = 'bolita' AND status IN ('open', 'scheduled')
     ORDER BY scheduled_time ASC`
  );
  if (rows.length === 0) return;

  let contract;
  try {
    contract = getBolitaContract();
  } catch (err) {
    console.warn('[BolitaScheduler] Cleanup: contract not available, skipping orphan check');
    return;
  }

  for (const row of rows) {
    try {
      const onChain = await contract.draws(row.id);
      if (Number(onChain.id) === 0) {
        // Draw in DB but not on-chain — orphan from old off-chain scheduler
        console.log(`[BolitaScheduler] Cleanup: removing orphan draw "${row.draw_number}" (db_id=${row.id}) — not on-chain`);
        await pool.query(`DELETE FROM draws WHERE id = $1`, [row.id]);
      }
    } catch (err) {
      // RPC error — skip this draw, leave it for next startup
      console.warn(`[BolitaScheduler] Cleanup: could not verify draw ${row.id}: ${err.message}`);
    }
  }
}

// ── Startup recovery ───────────────────────────────────────────────────────

/**
 * On restart, reconcile any draws left in intermediate states.
 * - 'open' draws past scheduled_time → closeDraw()
 * - 'scheduled' draws → openDraw()
 */
async function _recoverOnStartup() {
  // Close OPEN draws that are past their scheduled time
  const { rows: expired } = await pool.query(
    `SELECT id, draw_number FROM draws
     WHERE draw_type = 'bolita' AND status = 'open'
       AND scheduled_time < NOW() - INTERVAL '2 minutes'
     ORDER BY scheduled_time ASC`
  );
  for (const draw of expired) {
    if (_stopRequested) return;
    console.log(`[BolitaScheduler] Recovery: closing expired open draw #${draw.id} "${draw.draw_number}"`);
    try {
      const contract = getBolitaContract();
      await sendTx(() =>
        contract.closeDraw(draw.id, AMOY_GAS_OVERRIDES).then(tx => tx.wait())
      );
      await pool.query(
        `UPDATE draws SET status = 'vrf_pending', updated_at = NOW() WHERE id = $1`,
        [draw.id]
      );
      console.log(`[BolitaScheduler] Recovery: draw #${draw.id} closed — VRF requested`);
    } catch (err) {
      console.error(`[BolitaScheduler] Recovery: closeDraw(${draw.id}) failed: ${err.message}`);
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

async function start() {
  if (_running) {
    console.log('[BolitaScheduler] Already running');
    return;
  }
  if (!process.env.BOLITA_CONTRACT_ADDRESS) {
    console.log('[BolitaScheduler] BOLITA_CONTRACT_ADDRESS not set — scheduler disabled');
    return;
  }

  _running = true;
  _stopRequested = false;

  const times = parseDrawTimes();
  const labels = times.map(t =>
    `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
  ).join(', ');
  const openMin = Math.round(openBeforeMs() / 60000);
  console.log(`[BolitaScheduler] Starting — draw times (UTC): ${labels} | open window: ${openMin} min before close`);

  try {
    await _cleanupOrphanDraws();
  } catch (err) {
    console.error('[BolitaScheduler] Orphan cleanup error (non-fatal):', err.message);
  }

  try {
    await _recoverOnStartup();
  } catch (err) {
    console.error('[BolitaScheduler] Startup recovery error (non-fatal):', err.message);
  }

  // First poll after 3s (let other services settle)
  _pollTimer = setTimeout(_tick, 3000);
  console.log('[BolitaScheduler] Active');
}

function stop() {
  _stopRequested = true;
  if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
  _running = false;
  console.log('[BolitaScheduler] Stopped');
}

function isRunning() { return _running; }

module.exports = { start, stop, isRunning };
