/**
 * Monitoring Service
 *
 * Runs periodic health checks and sends Telegram alerts when issues are detected.
 *
 * Checks every MONITORING_INTERVAL_MIN minutes (default: 5):
 *   1. Keno pool balance — warning / critical thresholds
 *   2. Bolita pool balance — reads contract availablePool() if address set
 *   3. Stale VRF draws   — bolita draws stuck in vrf_pending > 2.5h
 *   4. DB connectivity   — implicit (queries fail if DB is down)
 *
 * Anti-spam: each alert type is silenced for ALERT_COOLDOWN_MIN after firing.
 * Sends a startup notification so you know when Railway redeploys.
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN   — from @BotFather
 *   TELEGRAM_CHAT_ID     — target chat or channel ID (negative for groups)
 *
 * Optional:
 *   MONITORING_INTERVAL_MIN  — check interval in minutes (default: 5)
 *   ALERT_COOLDOWN_MIN       — minutes to silence repeated same-type alerts (default: 30)
 */

const https = require('https');
const pool  = require('../db');

// ── Config ──────────────────────────────────────────────────────────────────

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID      = process.env.TELEGRAM_CHAT_ID;
const INTERVAL_MS  = (parseInt(process.env.MONITORING_INTERVAL_MIN)  || 5)  * 60 * 1000;
const COOLDOWN_MS  = (parseInt(process.env.ALERT_COOLDOWN_MIN)        || 30) * 60 * 1000;

// VRF stale threshold — same as BolitaScheduler constant
const VRF_STALE_MS = 150 * 60 * 1000; // 2h 30min

// ── Alert state — tracks last fire time per alert key to avoid spam ─────────
const _lastAlerted = {};

function _canAlert(key) {
  const last = _lastAlerted[key] || 0;
  return (Date.now() - last) >= COOLDOWN_MS;
}

function _markAlerted(key) {
  _lastAlerted[key] = Date.now();
}

function _clearAlert(key) {
  delete _lastAlerted[key];
}

// ── Telegram sender ──────────────────────────────────────────────────────────

function _send(text) {
  if (!BOT_TOKEN || !CHAT_ID) return Promise.resolve(); // not configured — silent

  const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.warn(`[Monitor] Telegram API error ${res.statusCode}:`, data);
          } else {
            const parsed = JSON.parse(data);
            if (!parsed.ok) console.warn('[Monitor] Telegram API not ok:', data);
          }
          resolve();
        });
      }
    );
    req.on('error', (err) => {
      console.warn('[Monitor] Telegram send error:', err.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

// ── Individual checks ────────────────────────────────────────────────────────

async function _checkKenoPool() {
  try {
    const gameConfigService = require('./gameConfigService');
    const balance = await gameConfigService.getPoolBalance();
    const minRequired = await gameConfigService.getConfigValue('keno_min_pool_balance', 500);

    const warningPct  = await gameConfigService.getConfigValue('keno_pool_warning_threshold',  0.30);
    const criticalPct = await gameConfigService.getConfigValue('keno_pool_critical_threshold', 0.15);

    const warnLevel     = minRequired * warningPct;
    const criticalLevel = minRequired * criticalPct;

    if (balance <= 0) {
      if (_canAlert('keno_depleted')) {
        _markAlerted('keno_depleted');
        await _send(`🚨 <b>KENO POOL AGOTADO</b>\nBalance: $0 USDT\nEl pool no puede cubrir pagos. Fondear urgente.`);
      }
    } else if (balance < criticalLevel) {
      if (_canAlert('keno_critical')) {
        _markAlerted('keno_critical');
        await _send(`🔴 <b>Keno Pool CRÍTICO</b>\nBalance: <b>$${balance.toFixed(2)}</b> / mín $${minRequired}\n(${((balance / minRequired) * 100).toFixed(0)}% del mínimo)\nFondear pronto.`);
      }
    } else if (balance < warnLevel) {
      if (_canAlert('keno_warning')) {
        _markAlerted('keno_warning');
        await _send(`⚠️ <b>Keno Pool bajo</b>\nBalance: <b>$${balance.toFixed(2)}</b> / mín $${minRequired}\n(${((balance / minRequired) * 100).toFixed(0)}% del mínimo)`);
      }
    } else {
      // Pool healthy — clear alerts so they can fire again if it drops again later
      _clearAlert('keno_depleted');
      _clearAlert('keno_critical');
      _clearAlert('keno_warning');
    }
  } catch (err) {
    console.warn('[Monitor] Keno pool check failed:', err.message);
  }
}

async function _checkBolitaPool() {
  if (!process.env.BOLITA_CONTRACT_ADDRESS) return;

  try {
    const { getBolitaContractReadOnly } = require('../chain/bolitaProvider');
    const { ethers } = require('ethers');
    const contract = getBolitaContractReadOnly();
    const raw = await contract.availablePool();
    const balance = parseFloat(ethers.formatUnits(raw, 6));

    // Warn if pool drops below 100 USDT (arbitrary floor for testnet — adjust for mainnet)
    const BOLITA_WARN_THRESHOLD = parseFloat(process.env.BOLITA_POOL_WARN_THRESHOLD || '100');

    if (balance <= 0) {
      if (_canAlert('bolita_depleted')) {
        _markAlerted('bolita_depleted');
        await _send(`🚨 <b>LA BOLITA POOL AGOTADO</b>\nBalance: $0 USDT\nLas apuestas serán rechazadas. Fondear urgente.`);
      }
    } else if (balance < BOLITA_WARN_THRESHOLD) {
      if (_canAlert('bolita_warning')) {
        _markAlerted('bolita_warning');
        await _send(`⚠️ <b>La Bolita Pool bajo</b>\nBalance: <b>$${balance.toFixed(2)}</b> USDT\n(umbral de alerta: $${BOLITA_WARN_THRESHOLD})`);
      }
    } else {
      _clearAlert('bolita_depleted');
      _clearAlert('bolita_warning');
    }
  } catch (err) {
    console.warn('[Monitor] Bolita pool check failed:', err.message);
  }
}

async function _checkStaleVrfDraws() {
  if (!process.env.BOLITA_CONTRACT_ADDRESS) return;

  try {
    const { rows } = await pool.query(
      `SELECT id, draw_number, updated_at FROM draws
       WHERE draw_type = 'bolita'
         AND status = 'vrf_pending'
         AND winning_parles IS NULL
         AND updated_at < NOW() - INTERVAL '150 minutes'`
    );

    if (rows.length === 0) {
      _clearAlert('bolita_vrf_stale');
      return;
    }

    if (_canAlert('bolita_vrf_stale')) {
      _markAlerted('bolita_vrf_stale');
      const list = rows.map(r =>
        `  • #${r.id} "${r.draw_number}" — pendiente desde ${new Date(r.updated_at).toUTCString()}`
      ).join('\n');
      await _send(`🟠 <b>VRF Bolita atascado</b>\n${rows.length} draw(s) en vrf_pending &gt;2.5h sin resolver:\n${list}\nRevisar suscripción Chainlink VRF.`);
    }
  } catch (err) {
    console.warn('[Monitor] VRF stale check failed:', err.message);
  }
}

// ── Poll tick ────────────────────────────────────────────────────────────────

let _timer = null;

async function _tick() {
  await Promise.allSettled([
    _checkKenoPool(),
    _checkBolitaPool(),
    _checkStaleVrfDraws(),
  ]);
  _timer = setTimeout(_tick, INTERVAL_MS);
}

// ── Public API ───────────────────────────────────────────────────────────────

async function start() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[Monitor] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — monitoring alerts disabled');
    return;
  }

  // Startup notification
  const env = process.env.NODE_ENV || 'development';
  await _send(`✅ <b>Bolcoin backend arrancó</b>\nEntorno: ${env}\n${new Date().toUTCString()}`);

  console.log(`[Monitor] Active — checking every ${INTERVAL_MS / 60000} min, cooldown ${COOLDOWN_MS / 60000} min`);

  // First check after 30s (let other services settle)
  _timer = setTimeout(_tick, 30 * 1000);
}

function stop() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

module.exports = { start, stop };
