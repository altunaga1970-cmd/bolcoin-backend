const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/adminAuth');
const { dbAvailable, query } = require('../config/database');
const featureFlagService = require('../services/featureFlagService');
const AuditLog = require('../models/AuditLog');

// All routes require admin auth
router.use(requireAdmin);

/**
 * GET /api/admin/ops/summary
 * Aggregated system health + financial totals
 */
router.get('/summary', async (req, res) => {
  try {
    let totals = { totalUsers: 0, totalDeposits: 0, totalWithdrawals: 0, totalFees: 0 };
    let pendingWithdrawals = { count: 0, totalAmount: 0 };
    let health = dbAvailable ? 'healthy' : 'degraded';

    if (dbAvailable) {
      try {
        const [usersRes, depositsRes, withdrawalsRes, feesRes, pendingCountRes, pendingAmountRes] = await Promise.all([
          query('SELECT COUNT(*) FROM users'),
          query("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE status='completed' AND type='deposit'"),
          query("SELECT COALESCE(SUM(amount),0) as total FROM withdrawals WHERE status='completed'"),
          query("SELECT COALESCE(SUM(fee),0) as total FROM withdrawals WHERE status='completed'"),
          query("SELECT COUNT(*) FROM withdrawals WHERE status='pending'"),
          query("SELECT COALESCE(SUM(amount),0) as total FROM withdrawals WHERE status='pending'")
        ]);

        totals = {
          totalUsers: parseInt(usersRes.rows[0].count),
          totalDeposits: parseFloat(depositsRes.rows[0].total),
          totalWithdrawals: parseFloat(withdrawalsRes.rows[0].total),
          totalFees: parseFloat(feesRes.rows[0].total)
        };
        pendingWithdrawals = {
          count: parseInt(pendingCountRes.rows[0].count),
          totalAmount: parseFloat(pendingAmountRes.rows[0].total)
        };
      } catch (dbErr) {
        console.error('[AdminOps] DB query error:', dbErr.message);
        health = 'degraded';
      }
    }

    // Keno pool - try to get if available
    let kenoPool = null;
    try {
      const bankrollService = require('../services/bankrollService');
      if (bankrollService && bankrollService.getPoolStatus) {
        kenoPool = await bankrollService.getPoolStatus();
      }
    } catch (e) {
      // not available
    }

    // Feature flags
    let flags = {};
    try {
      flags = await featureFlagService.getFlagsSimple();
    } catch (e) {
      // use empty
    }

    res.json({
      success: true,
      health,
      dbAvailable,
      schedulerRunning: true,
      uptime: process.uptime(),
      totals,
      pendingWithdrawals,
      kenoPool,
      flags
    });
  } catch (error) {
    console.error('[AdminOps] Summary error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/admin/ops/toggles
 * Read operational feature flags
 */
router.get('/toggles', async (req, res) => {
  try {
    const flags = await featureFlagService.getFlagsSimple();
    res.json({ success: true, flags });
  } catch (error) {
    console.error('[AdminOps] Toggles read error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/admin/ops/toggles
 * Toggle a feature flag
 * Body: { key: string, enabled: boolean }
 */
router.post('/toggles', async (req, res) => {
  try {
    const { key, enabled } = req.body;

    if (!key || typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'key (string) and enabled (boolean) required' });
    }

    const result = await featureFlagService.setFlag(key, enabled);

    // Audit log
    await AuditLog.create({
      action: 'toggle_changed',
      entity_type: 'system',
      actor_address: req.admin.address,
      details: { key, enabled }
    });

    res.json({ success: true, flag: result });
  } catch (error) {
    console.error('[AdminOps] Toggle set error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
