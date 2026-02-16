/**
 * Admin Bolita Routes
 *
 * Endpoints for La Bolita pool monitoring and draw management.
 * Follows the same pattern as Keno admin routes.
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const pool = require('../db');

// All routes require admin auth
router.use(authenticate, requireAdmin);

/**
 * GET /api/admin/bolita/pool
 * Pool status: balance, totals, health
 */
router.get('/pool', async (req, res) => {
  try {
    const [
      drawsRes,
      betsRes,
      activeBetsRes,
      recentPayoutsRes
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'open') as open_draws,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_draws,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_draws,
          COUNT(*) as total_draws
        FROM draws WHERE draw_type = 'bolita'
      `),
      pool.query(`
        SELECT
          COUNT(*) as total_bets,
          COALESCE(SUM(amount), 0) as total_wagered,
          COALESCE(SUM(CASE WHEN status = 'won' THEN payout ELSE 0 END), 0) as total_payouts,
          COALESCE(SUM(CASE WHEN status = 'won' THEN payout - amount ELSE 0 END), 0) as net_payouts
        FROM bets
        WHERE game_type IN ('fijo', 'centena', 'parle')
      `),
      pool.query(`
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(amount), 0) as total_amount
        FROM bets
        WHERE game_type IN ('fijo', 'centena', 'parle')
          AND status = 'pending'
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(payout), 0) as recent_payouts
        FROM bets
        WHERE game_type IN ('fijo', 'centena', 'parle')
          AND status = 'won'
          AND updated_at > NOW() - INTERVAL '24 hours'
      `)
    ]);

    const draws = drawsRes.rows[0];
    const bets = betsRes.rows[0];
    const activeBets = activeBetsRes.rows[0];
    const recentPayouts = recentPayoutsRes.rows[0];

    const totalWagered = parseFloat(bets.total_wagered);
    const totalPayouts = parseFloat(bets.total_payouts);
    const houseEdge = totalWagered > 0 ? ((totalWagered - totalPayouts) / totalWagered * 100) : 0;

    res.json({
      success: true,
      data: {
        pool: {
          totalBets: parseInt(bets.total_bets),
          totalWagered,
          totalPayouts,
          netProfit: totalWagered - totalPayouts,
          houseEdgePercent: Math.round(houseEdge * 100) / 100
        },
        draws: {
          open: parseInt(draws.open_draws),
          completed: parseInt(draws.completed_draws),
          cancelled: parseInt(draws.cancelled_draws),
          total: parseInt(draws.total_draws)
        },
        activeBets: {
          count: parseInt(activeBets.count),
          totalAmount: parseFloat(activeBets.total_amount)
        },
        recentPayouts24h: parseFloat(recentPayouts.recent_payouts),
        health: {
          status: parseInt(draws.open_draws) > 0 ? 'active' : 'idle',
          activeBets: parseInt(activeBets.count)
        }
      }
    });
  } catch (err) {
    console.error('[AdminBolita] Error getting pool status:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/bolita/draws
 * Active and recent draws
 */
router.get('/draws', async (req, res) => {
  try {
    const { status = 'all', limit = 20 } = req.query;

    let whereClause = "WHERE draw_type = 'bolita'";
    const params = [];

    if (status !== 'all') {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }

    params.push(parseInt(limit));

    const result = await pool.query(`
      SELECT
        d.id, d.draw_number, d.draw_type, d.status,
        d.scheduled_time, d.winning_number,
        d.created_at, d.updated_at,
        COUNT(b.id) as bet_count,
        COALESCE(SUM(b.amount), 0) as total_wagered,
        COALESCE(SUM(CASE WHEN b.status = 'won' THEN b.payout ELSE 0 END), 0) as total_payouts
      FROM draws d
      LEFT JOIN bets b ON b.draw_id = d.id
      ${whereClause}
      GROUP BY d.id
      ORDER BY d.scheduled_time DESC
      LIMIT $${params.length}
    `, params);

    res.json({
      success: true,
      data: {
        draws: result.rows.map(row => ({
          id: row.id,
          drawNumber: row.draw_number,
          status: row.status,
          scheduledTime: row.scheduled_time,
          winningNumber: row.winning_number,
          betCount: parseInt(row.bet_count),
          totalWagered: parseFloat(row.total_wagered),
          totalPayouts: parseFloat(row.total_payouts),
          netResult: parseFloat(row.total_wagered) - parseFloat(row.total_payouts),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })),
        count: result.rows.length
      }
    });
  } catch (err) {
    console.error('[AdminBolita] Error getting draws:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/bolita/exposures
 * Current exposure by number for open draws
 */
router.get('/exposures', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.id as draw_id,
        d.draw_number,
        b.game_type,
        b.number as bet_number,
        COUNT(*) as bet_count,
        SUM(b.amount) as total_amount,
        SUM(b.amount * CASE
          WHEN b.game_type = 'fijo' THEN 65
          WHEN b.game_type = 'centena' THEN 300
          WHEN b.game_type = 'parle' THEN 1000
          ELSE 1
        END) as max_exposure
      FROM bets b
      JOIN draws d ON d.id = b.draw_id
      WHERE d.status = 'open'
        AND d.draw_type = 'bolita'
        AND b.status = 'pending'
      GROUP BY d.id, d.draw_number, b.game_type, b.number
      ORDER BY max_exposure DESC
      LIMIT 50
    `);

    res.json({
      success: true,
      data: {
        exposures: result.rows.map(row => ({
          drawId: row.draw_id,
          drawNumber: row.draw_number,
          gameType: row.game_type,
          betNumber: row.bet_number,
          betCount: parseInt(row.bet_count),
          totalAmount: parseFloat(row.total_amount),
          maxExposure: parseFloat(row.max_exposure)
        }))
      }
    });
  } catch (err) {
    console.error('[AdminBolita] Error getting exposures:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/bolita/history
 * Daily aggregated history for charts
 */
router.get('/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;

    const result = await pool.query(`
      SELECT
        DATE(d.scheduled_time) as day,
        COUNT(DISTINCT d.id) as draws,
        COUNT(b.id) as bets,
        COALESCE(SUM(b.amount), 0) as wagered,
        COALESCE(SUM(CASE WHEN b.status = 'won' THEN b.payout ELSE 0 END), 0) as payouts
      FROM draws d
      LEFT JOIN bets b ON b.draw_id = d.id
      WHERE d.draw_type = 'bolita'
        AND d.scheduled_time > NOW() - ($1 || ' days')::INTERVAL
      GROUP BY DATE(d.scheduled_time)
      ORDER BY day DESC
    `, [days]);

    res.json({
      success: true,
      data: {
        history: result.rows.map(row => ({
          day: row.day,
          draws: parseInt(row.draws),
          bets: parseInt(row.bets),
          wagered: parseFloat(row.wagered),
          payouts: parseFloat(row.payouts),
          profit: parseFloat(row.wagered) - parseFloat(row.payouts)
        })),
        days
      }
    });
  } catch (err) {
    console.error('[AdminBolita] Error getting history:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
