/**
 * Settlement Service
 * Handles daily settlements and monthly commission calculations
 */

const { pool } = require('../db');
const { RISK_CONFIG } = require('../config/constants');
const riskService = require('./riskService');

class SettlementService {
    /**
     * Get settlement status for a day
     */
    async getDaySettlement(dayId) {
        const result = await pool.query(`
            SELECT *
            FROM daily_settlements
            WHERE day_id = $1
        `, [dayId]);

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        return {
            dayId: row.day_id,
            totalStaked: parseFloat(row.total_staked),
            totalPaidOut: parseFloat(row.total_paid_out),
            profitOrLoss: parseFloat(row.profit_or_loss),
            drawsCount: row.draws_count,
            betsCount: row.bets_count,
            winnersCount: row.winners_count,
            settled: row.settled,
            settledAt: row.settled_at,
            settledBy: row.settled_by,
            notes: row.notes
        };
    }

    /**
     * Prepare daily settlement data (without committing)
     */
    async prepareDailySettlement(dayId) {
        // Get all completed draws for this day
        const drawsResult = await pool.query(`
            SELECT id, total_amount, total_paid_out
            FROM draws
            WHERE day_id = $1 AND status = 'completed'
        `, [dayId]);

        if (drawsResult.rows.length === 0) {
            return {
                dayId,
                canSettle: false,
                reason: 'No completed draws found for this day',
                data: null
            };
        }

        // Check if any draws are still open or closed (not completed)
        const pendingDraws = await pool.query(`
            SELECT COUNT(*) as count
            FROM draws
            WHERE day_id = $1 AND status IN ('open', 'closed', 'vrf_requested')
        `, [dayId]);

        if (parseInt(pendingDraws.rows[0].count) > 0) {
            return {
                dayId,
                canSettle: false,
                reason: 'There are still pending draws for this day',
                pendingCount: parseInt(pendingDraws.rows[0].count),
                data: null
            };
        }

        // Calculate totals
        let totalStaked = 0;
        let totalPaidOut = 0;
        const drawIds = [];

        for (const draw of drawsResult.rows) {
            totalStaked += parseFloat(draw.total_amount) || 0;
            totalPaidOut += parseFloat(draw.total_paid_out) || 0;
            drawIds.push(draw.id);
        }

        // Get bet counts
        const betsResult = await pool.query(`
            SELECT
                COUNT(*) as total_bets,
                COUNT(CASE WHEN payout > 0 THEN 1 END) as winners
            FROM bets
            WHERE draw_id = ANY($1)
        `, [drawIds]);

        const betsCount = parseInt(betsResult.rows[0].total_bets) || 0;
        const winnersCount = parseInt(betsResult.rows[0].winners) || 0;

        const profitOrLoss = totalStaked - totalPaidOut;

        return {
            dayId,
            canSettle: true,
            data: {
                totalStaked,
                totalPaidOut,
                profitOrLoss,
                drawsCount: drawsResult.rows.length,
                betsCount,
                winnersCount,
                drawIds
            }
        };
    }

    /**
     * Execute daily settlement
     */
    async settleDailyResults(dayId, settledBy, notes = null) {
        // Check if already settled
        const existing = await this.getDaySettlement(dayId);
        if (existing && existing.settled) {
            throw new Error('Day already settled');
        }

        // Prepare settlement data
        const prepared = await this.prepareDailySettlement(dayId);
        if (!prepared.canSettle) {
            throw new Error(prepared.reason);
        }

        const { totalStaked, totalPaidOut, profitOrLoss, drawsCount, betsCount, winnersCount } = prepared.data;

        // Insert or update settlement record
        await pool.query(`
            INSERT INTO daily_settlements (
                day_id, total_staked, total_paid_out, profit_or_loss,
                draws_count, bets_count, winners_count,
                settled, settled_at, settled_by, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, CURRENT_TIMESTAMP, $8, $9)
            ON CONFLICT (day_id) DO UPDATE SET
                total_staked = EXCLUDED.total_staked,
                total_paid_out = EXCLUDED.total_paid_out,
                profit_or_loss = EXCLUDED.profit_or_loss,
                draws_count = EXCLUDED.draws_count,
                bets_count = EXCLUDED.bets_count,
                winners_count = EXCLUDED.winners_count,
                settled = TRUE,
                settled_at = CURRENT_TIMESTAMP,
                settled_by = EXCLUDED.settled_by,
                notes = EXCLUDED.notes
        `, [dayId, totalStaked, totalPaidOut, profitOrLoss, drawsCount, betsCount, winnersCount, settledBy, notes]);

        // Update monthly accounting
        const monthId = this.getMonthIdFromDayId(dayId);
        await this.updateMonthlyAccounting(monthId, profitOrLoss, totalStaked, totalPaidOut);

        return {
            dayId,
            totalStaked,
            totalPaidOut,
            profitOrLoss,
            drawsCount,
            betsCount,
            winnersCount,
            settledAt: new Date(),
            settledBy
        };
    }

    /**
     * Get month ID from day ID
     */
    getMonthIdFromDayId(dayId) {
        const date = new Date(dayId * 86400 * 1000);
        return date.getFullYear() * 100 + (date.getMonth() + 1);
    }

    /**
     * Update monthly accounting after a day is settled
     */
    async updateMonthlyAccounting(monthId, profitOrLoss, totalStaked, totalPaidOut) {
        const year = Math.floor(monthId / 100);
        const month = monthId % 100;

        await pool.query(`
            INSERT INTO monthly_accounting (
                month_id, year, month, total_staked, total_paid_out,
                net_profit, days_settled
            ) VALUES ($1, $2, $3, $4, $5, $6, 1)
            ON CONFLICT (month_id) DO UPDATE SET
                total_staked = monthly_accounting.total_staked + EXCLUDED.total_staked,
                total_paid_out = monthly_accounting.total_paid_out + EXCLUDED.total_paid_out,
                net_profit = monthly_accounting.net_profit + $6,
                days_settled = monthly_accounting.days_settled + 1,
                updated_at = CURRENT_TIMESTAMP
        `, [monthId, year, month, totalStaked, totalPaidOut, profitOrLoss]);
    }

    /**
     * Get monthly accounting record
     */
    async getMonthlyAccounting(monthId) {
        const result = await pool.query(`
            SELECT *
            FROM monthly_accounting
            WHERE month_id = $1
        `, [monthId]);

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        return {
            monthId: row.month_id,
            year: row.year,
            month: row.month,
            totalStaked: parseFloat(row.total_staked),
            totalPaidOut: parseFloat(row.total_paid_out),
            netProfit: parseFloat(row.net_profit),
            operatorFee: parseFloat(row.operator_fee),
            commissionPaid: row.commission_paid,
            paidAt: row.paid_at,
            paidTxHash: row.paid_tx_hash,
            daysSettled: row.days_settled
        };
    }

    /**
     * Calculate monthly commission
     */
    async calculateMonthlyCommission(monthId) {
        const accounting = await this.getMonthlyAccounting(monthId);

        if (!accounting) {
            throw new Error('No accounting record found for this month');
        }

        if (accounting.commissionPaid) {
            throw new Error('Commission already calculated/paid for this month');
        }

        let operatorFee = 0;
        if (accounting.netProfit > 0) {
            operatorFee = (accounting.netProfit * RISK_CONFIG.OPERATOR_COMMISSION_BPS) / 10000;
        }

        await pool.query(`
            UPDATE monthly_accounting
            SET operator_fee = $1, updated_at = CURRENT_TIMESTAMP
            WHERE month_id = $2
        `, [operatorFee, monthId]);

        return {
            monthId,
            netProfit: accounting.netProfit,
            operatorFee,
            commissionBps: RISK_CONFIG.OPERATOR_COMMISSION_BPS
        };
    }

    /**
     * Mark commission as paid
     */
    async markCommissionPaid(monthId, txHash = null) {
        await pool.query(`
            UPDATE monthly_accounting
            SET commission_paid = TRUE, paid_at = CURRENT_TIMESTAMP, paid_tx_hash = $1
            WHERE month_id = $2
        `, [txHash, monthId]);

        return await this.getMonthlyAccounting(monthId);
    }

    /**
     * Record operator withdrawal
     */
    async recordOperatorWithdrawal(amount, withdrawalType, monthId, txHash, withdrawnBy, notes = null) {
        await pool.query(`
            INSERT INTO operator_withdrawals (
                amount, withdrawal_type, month_id, tx_hash, withdrawn_by, notes
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [amount, withdrawalType, monthId, txHash, withdrawnBy, notes]);
    }

    /**
     * Get operator withdrawals
     */
    async getOperatorWithdrawals(limit = 20) {
        const result = await pool.query(`
            SELECT *
            FROM operator_withdrawals
            ORDER BY withdrawn_at DESC
            LIMIT $1
        `, [limit]);

        return result.rows.map(row => ({
            id: row.id,
            amount: parseFloat(row.amount),
            withdrawalType: row.withdrawal_type,
            monthId: row.month_id,
            txHash: row.tx_hash,
            withdrawnBy: row.withdrawn_by,
            withdrawnAt: row.withdrawn_at,
            notes: row.notes
        }));
    }

    /**
     * Get pending settlements (days that need to be settled)
     */
    async getPendingSettlements() {
        const currentDayId = riskService.getCurrentDayId();

        // Get days with completed draws that haven't been settled
        const result = await pool.query(`
            SELECT DISTINCT d.day_id, COUNT(d.id) as draws_count
            FROM draws d
            LEFT JOIN daily_settlements ds ON d.day_id = ds.day_id
            WHERE d.status = 'completed'
              AND d.day_id < $1
              AND (ds.settled IS NULL OR ds.settled = FALSE)
            GROUP BY d.day_id
            ORDER BY d.day_id ASC
        `, [currentDayId]);

        return result.rows.map(row => ({
            dayId: row.day_id,
            date: new Date(row.day_id * 86400 * 1000).toISOString().split('T')[0],
            drawsCount: parseInt(row.draws_count)
        }));
    }

    /**
     * Get pending commissions (months that need commission calculated)
     */
    async getPendingCommissions() {
        const currentMonthId = riskService.getCurrentMonthId();

        const result = await pool.query(`
            SELECT *
            FROM monthly_accounting
            WHERE commission_paid = FALSE
              AND month_id < $1
              AND net_profit > 0
            ORDER BY month_id ASC
        `, [currentMonthId]);

        return result.rows.map(row => ({
            monthId: row.month_id,
            year: row.year,
            month: row.month,
            netProfit: parseFloat(row.net_profit),
            operatorFee: parseFloat(row.operator_fee),
            daysSettled: row.days_settled
        }));
    }

    /**
     * Get settlement summary for dashboard
     */
    async getSettlementSummary() {
        // Get recent settlements
        const recentSettlements = await pool.query(`
            SELECT *
            FROM daily_settlements
            WHERE settled = TRUE
            ORDER BY day_id DESC
            LIMIT 7
        `);

        // Get monthly summaries
        const monthlySummary = await pool.query(`
            SELECT *
            FROM monthly_accounting
            ORDER BY month_id DESC
            LIMIT 3
        `);

        // Get pending counts
        const pendingSettlements = await this.getPendingSettlements();
        const pendingCommissions = await this.getPendingCommissions();

        // Calculate totals
        const totalResult = await pool.query(`
            SELECT
                COALESCE(SUM(total_staked), 0) as total_staked,
                COALESCE(SUM(total_paid_out), 0) as total_paid_out,
                COALESCE(SUM(profit_or_loss), 0) as total_profit,
                COUNT(*) as days_settled
            FROM daily_settlements
            WHERE settled = TRUE
        `);

        return {
            recentSettlements: recentSettlements.rows.map(row => ({
                dayId: row.day_id,
                date: new Date(row.day_id * 86400 * 1000).toISOString().split('T')[0],
                totalStaked: parseFloat(row.total_staked),
                totalPaidOut: parseFloat(row.total_paid_out),
                profitOrLoss: parseFloat(row.profit_or_loss),
                drawsCount: row.draws_count
            })),
            monthlySummary: monthlySummary.rows.map(row => ({
                monthId: row.month_id,
                year: row.year,
                month: row.month,
                totalStaked: parseFloat(row.total_staked),
                totalPaidOut: parseFloat(row.total_paid_out),
                netProfit: parseFloat(row.net_profit),
                operatorFee: parseFloat(row.operator_fee),
                commissionPaid: row.commission_paid
            })),
            pendingSettlementsCount: pendingSettlements.length,
            pendingCommissionsCount: pendingCommissions.length,
            totals: {
                totalStaked: parseFloat(totalResult.rows[0].total_staked),
                totalPaidOut: parseFloat(totalResult.rows[0].total_paid_out),
                totalProfit: parseFloat(totalResult.rows[0].total_profit),
                daysSettled: parseInt(totalResult.rows[0].days_settled)
            }
        };
    }
}

module.exports = new SettlementService();
