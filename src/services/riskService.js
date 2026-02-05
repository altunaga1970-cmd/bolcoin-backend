/**
 * Risk Management Service
 * Handles exposure tracking, payout cap calculations, and risk monitoring
 */

const { pool } = require('../db');
const { RISK_CONFIG } = require('../config/constants');

class RiskService {
    /**
     * Get current day ID (Unix timestamp / 86400)
     */
    getCurrentDayId() {
        return Math.floor(Date.now() / 1000 / 86400);
    }

    /**
     * Get current month ID (YYYYMM format)
     */
    getCurrentMonthId() {
        const now = new Date();
        return now.getFullYear() * 100 + (now.getMonth() + 1);
    }

    /**
     * Calculate usable balance from total pool
     */
    calculateUsableBalance(totalPool) {
        const reserveAmount = (totalPool * RISK_CONFIG.RESERVE_RATIO_BPS) / 10000;
        return Math.max(0, totalPool - reserveAmount);
    }

    /**
     * Calculate payout cap from total pool
     */
    calculatePayoutCap(totalPool) {
        const usable = this.calculateUsableBalance(totalPool);
        const riskBased = (usable * RISK_CONFIG.RISK_FACTOR_BPS) / 10000;
        return Math.min(riskBased, RISK_CONFIG.ABSOLUTE_MAX_PAYOUT);
    }

    /**
     * Get multiplier for bet type
     */
    getMultiplier(betType) {
        const type = betType.toLowerCase();
        if (type === 'fijo' || type === 'fijos') return RISK_CONFIG.MULTIPLIERS.FIJO;
        if (type === 'centena' || type === 'centenas') return RISK_CONFIG.MULTIPLIERS.CENTENA;
        if (type === 'parle' || type === 'parles') return RISK_CONFIG.MULTIPLIERS.PARLE;
        return 0;
    }

    /**
     * Calculate potential liability for a bet
     */
    calculateLiability(betType, stake) {
        return stake * this.getMultiplier(betType);
    }

    /**
     * Get current exposure for a specific number/type/day
     */
    async getExposure(dayId, betType, number) {
        const result = await pool.query(`
            SELECT total_stake, total_liability, bet_count
            FROM daily_exposure
            WHERE day_id = $1 AND bet_type = $2 AND number = $3
        `, [dayId, betType.toLowerCase(), number]);

        if (result.rows.length === 0) {
            return { totalStake: 0, totalLiability: 0, betCount: 0 };
        }

        const row = result.rows[0];
        return {
            totalStake: parseFloat(row.total_stake) || 0,
            totalLiability: parseFloat(row.total_liability) || 0,
            betCount: parseInt(row.bet_count) || 0
        };
    }

    /**
     * Check if a bet can be placed based on exposure limits
     */
    async canPlaceBet(dayId, betType, number, stake, totalPool) {
        const exposure = await this.getExposure(dayId, betType, number);
        const newLiability = this.calculateLiability(betType, stake);
        const payoutCap = this.calculatePayoutCap(totalPool);

        const projectedLiability = exposure.totalLiability + newLiability;
        const canPlace = projectedLiability <= payoutCap;

        return {
            canPlace,
            currentLiability: exposure.totalLiability,
            newLiability,
            projectedLiability,
            payoutCap,
            percentageUsed: payoutCap > 0 ? (projectedLiability / payoutCap) * 100 : 0
        };
    }

    /**
     * Get maximum allowed stake for a number
     */
    async getMaxAllowedStake(dayId, betType, number, totalPool) {
        const exposure = await this.getExposure(dayId, betType, number);
        const payoutCap = this.calculatePayoutCap(totalPool);

        if (exposure.totalLiability >= payoutCap) {
            return 0;
        }

        const availableLiability = payoutCap - exposure.totalLiability;
        const multiplier = this.getMultiplier(betType);

        if (multiplier === 0) return 0;

        const maxStake = availableLiability / multiplier;
        return Math.min(maxStake, RISK_CONFIG.MAX_STAKE);
    }

    /**
     * Update exposure after a bet is placed
     */
    async updateExposure(dayId, betType, number, stake) {
        const liability = this.calculateLiability(betType, stake);

        const result = await pool.query(`
            SELECT * FROM update_exposure($1, $2, $3, $4, $5)
        `, [dayId, betType.toLowerCase(), number, stake, liability]);

        return result.rows[0];
    }

    /**
     * Get all exposures for a day
     */
    async getDayExposures(dayId) {
        const result = await pool.query(`
            SELECT bet_type, number, total_stake, total_liability, bet_count
            FROM daily_exposure
            WHERE day_id = $1
            ORDER BY total_liability DESC
        `, [dayId]);

        return result.rows.map(row => ({
            betType: row.bet_type,
            number: row.number,
            totalStake: parseFloat(row.total_stake),
            totalLiability: parseFloat(row.total_liability),
            betCount: parseInt(row.bet_count)
        }));
    }

    /**
     * Get top exposures (numbers with highest liability)
     */
    async getTopExposures(dayId, limit = 10, totalPool) {
        const exposures = await this.getDayExposures(dayId);
        const payoutCap = this.calculatePayoutCap(totalPool);

        return exposures.slice(0, limit).map(exp => ({
            ...exp,
            percentageUsed: payoutCap > 0 ? (exp.totalLiability / payoutCap) * 100 : 0,
            payoutCap
        }));
    }

    /**
     * Get exposure alerts (numbers near or at limit)
     */
    async getExposureAlerts(dayId, totalPool) {
        const exposures = await this.getDayExposures(dayId);
        const payoutCap = this.calculatePayoutCap(totalPool);

        const alerts = [];
        for (const exp of exposures) {
            const percentage = payoutCap > 0 ? (exp.totalLiability / payoutCap) * 100 : 0;

            let alertLevel = null;
            if (percentage >= RISK_CONFIG.ALERT_THRESHOLDS.BLOCKED) {
                alertLevel = 'blocked';
            } else if (percentage >= RISK_CONFIG.ALERT_THRESHOLDS.CRITICAL) {
                alertLevel = 'critical';
            } else if (percentage >= RISK_CONFIG.ALERT_THRESHOLDS.WARNING) {
                alertLevel = 'warning';
            }

            if (alertLevel) {
                alerts.push({
                    ...exp,
                    percentageUsed: percentage,
                    alertLevel,
                    payoutCap
                });
            }
        }

        return alerts;
    }

    /**
     * Get bankroll information
     */
    async getBankrollInfo(totalPool) {
        const usableBalance = this.calculateUsableBalance(totalPool);
        const reserveAmount = totalPool - usableBalance;
        const payoutCap = this.calculatePayoutCap(totalPool);

        // Get pending operator fees from config or database
        let pendingFees = 0;
        try {
            const result = await pool.query(`
                SELECT COALESCE(SUM(operator_fee), 0) as pending_fees
                FROM monthly_accounting
                WHERE commission_paid = FALSE
            `);
            pendingFees = parseFloat(result.rows[0].pending_fees) || 0;
        } catch (e) {
            // Table might not exist yet
        }

        return {
            totalPool,
            usableBalance,
            reserveAmount,
            payoutCap,
            pendingOperatorFees: pendingFees,
            reserveRatioBps: RISK_CONFIG.RESERVE_RATIO_BPS,
            riskFactorBps: RISK_CONFIG.RISK_FACTOR_BPS,
            absoluteMaxPayout: RISK_CONFIG.ABSOLUTE_MAX_PAYOUT
        };
    }

    /**
     * Take a bankroll snapshot
     */
    async takeBankrollSnapshot(totalPool, source = 'manual', notes = null) {
        const info = await this.getBankrollInfo(totalPool);

        await pool.query(`
            INSERT INTO bankroll_snapshots (
                total_pool, usable_balance, reserve_amount, payout_cap,
                reserve_ratio_bps, risk_factor_bps, absolute_max_payout,
                pending_operator_fees, source, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            info.totalPool,
            info.usableBalance,
            info.reserveAmount,
            info.payoutCap,
            info.reserveRatioBps,
            info.riskFactorBps,
            info.absoluteMaxPayout,
            info.pendingOperatorFees,
            source,
            notes
        ]);

        return info;
    }

    /**
     * Get recent bankroll snapshots
     */
    async getBankrollSnapshots(limit = 10) {
        const result = await pool.query(`
            SELECT *
            FROM bankroll_snapshots
            ORDER BY snapshot_time DESC
            LIMIT $1
        `, [limit]);

        return result.rows.map(row => ({
            timestamp: row.snapshot_time,
            totalPool: parseFloat(row.total_pool),
            usableBalance: parseFloat(row.usable_balance),
            reserveAmount: parseFloat(row.reserve_amount),
            payoutCap: parseFloat(row.payout_cap),
            reserveRatioBps: parseInt(row.reserve_ratio_bps),
            riskFactorBps: parseInt(row.risk_factor_bps),
            absoluteMaxPayout: parseFloat(row.absolute_max_payout),
            pendingOperatorFees: parseFloat(row.pending_operator_fees),
            source: row.source,
            notes: row.notes
        }));
    }

    /**
     * Get risk configuration
     */
    async getRiskConfig() {
        const result = await pool.query(`
            SELECT config_key, config_value, description
            FROM risk_config
            ORDER BY config_key
        `);

        const config = {};
        for (const row of result.rows) {
            config[row.config_key] = {
                value: row.config_value,
                description: row.description
            };
        }

        return config;
    }

    /**
     * Update risk configuration
     */
    async updateRiskConfig(key, value, updatedBy) {
        await pool.query(`
            UPDATE risk_config
            SET config_value = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2
            WHERE config_key = $3
        `, [value, updatedBy, key]);
    }

    /**
     * Get day summary
     */
    async getDaySummary(dayId, totalPool) {
        const exposures = await this.getDayExposures(dayId);
        const alerts = await this.getExposureAlerts(dayId, totalPool);
        const bankroll = await this.getBankrollInfo(totalPool);

        const totalStake = exposures.reduce((sum, e) => sum + e.totalStake, 0);
        const totalLiability = exposures.reduce((sum, e) => sum + e.totalLiability, 0);
        const totalBets = exposures.reduce((sum, e) => sum + e.betCount, 0);

        return {
            dayId,
            date: new Date(dayId * 86400 * 1000).toISOString().split('T')[0],
            totalStake,
            totalLiability,
            totalBets,
            uniqueNumbers: exposures.length,
            alerts: {
                warning: alerts.filter(a => a.alertLevel === 'warning').length,
                critical: alerts.filter(a => a.alertLevel === 'critical').length,
                blocked: alerts.filter(a => a.alertLevel === 'blocked').length
            },
            bankroll
        };
    }
}

module.exports = new RiskService();
