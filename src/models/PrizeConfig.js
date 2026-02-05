const { query } = require('../config/database');
const { LOTTERY_CONFIG, BOLITA_CONFIG } = require('../config/prizeConfig');

// =================================
// PRIZE CONFIG MODEL
// Allows dynamic configuration overrides stored in database
// =================================

class PrizeConfig {
    /**
     * Get configuration value by key
     * Falls back to default from prizeConfig.js if not in database
     */
    static async get(key, defaultValue = null) {
        try {
            const result = await query(
                'SELECT value FROM prize_configs WHERE key = $1 AND is_active = true',
                [key]
            );

            if (result.rows.length > 0) {
                return JSON.parse(result.rows[0].value);
            }

            return defaultValue;
        } catch (error) {
            console.error(`Error getting prize config ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Set configuration value
     */
    static async set(key, value, updatedBy = null) {
        const jsonValue = JSON.stringify(value);

        const result = await query(`
            INSERT INTO prize_configs (key, value, updated_by, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (key) DO UPDATE
            SET value = $2, updated_by = $3, updated_at = NOW(), is_active = true
            RETURNING *
        `, [key, jsonValue, updatedBy]);

        return result.rows[0];
    }

    /**
     * Get all active configurations
     */
    static async getAll() {
        const result = await query(
            'SELECT * FROM prize_configs WHERE is_active = true ORDER BY key'
        );

        const configs = {};
        for (const row of result.rows) {
            configs[row.key] = JSON.parse(row.value);
        }

        return configs;
    }

    /**
     * Deactivate a configuration (revert to default)
     */
    static async deactivate(key) {
        await query(
            'UPDATE prize_configs SET is_active = false WHERE key = $1',
            [key]
        );
    }

    /**
     * Get lottery configuration with database overrides
     */
    static async getLotteryConfig() {
        const overrides = await this.getAll();

        // Start with defaults
        const config = JSON.parse(JSON.stringify(LOTTERY_CONFIG));

        // Apply overrides
        if (overrides.lottery_ticket_price) {
            config.ticket.priceUSDT = overrides.lottery_ticket_price;
        }
        if (overrides.lottery_revenue_distribution) {
            Object.assign(config.revenueDistribution, overrides.lottery_revenue_distribution);
        }
        if (overrides.lottery_jackpot_cap) {
            config.jackpot.capUSDT = overrides.lottery_jackpot_cap;
        }
        if (overrides.lottery_category_distribution) {
            Object.assign(config.categoryDistribution, overrides.lottery_category_distribution);
        }
        if (overrides.lottery_minimum_prizes) {
            Object.assign(config.minimumPrizes, overrides.lottery_minimum_prizes);
        }

        return config;
    }

    /**
     * Get bolita configuration with database overrides
     */
    static async getBolitaConfig() {
        const overrides = await this.getAll();

        // Start with defaults
        const config = JSON.parse(JSON.stringify(BOLITA_CONFIG));

        // Apply overrides
        if (overrides.bolita_revenue_distribution) {
            Object.assign(config.revenueDistribution, overrides.bolita_revenue_distribution);
        }
        if (overrides.bolita_multipliers) {
            Object.assign(config.multipliers, overrides.bolita_multipliers);
        }
        if (overrides.bolita_limits) {
            Object.assign(config.limits, overrides.bolita_limits);
        }

        return config;
    }

    /**
     * Get current jackpot amount
     */
    static async getJackpotAmount() {
        try {
            const result = await query(
                'SELECT jackpot_amount FROM jackpot_status ORDER BY updated_at DESC LIMIT 1'
            );

            if (result.rows.length > 0) {
                return parseFloat(result.rows[0].jackpot_amount);
            }

            // Return minimum start if no record
            const config = await this.getLotteryConfig();
            return config.jackpot.minStartUSDT;
        } catch (error) {
            console.error('Error getting jackpot amount:', error);
            return LOTTERY_CONFIG.jackpot.minStartUSDT;
        }
    }

    /**
     * Update jackpot amount
     */
    static async updateJackpotAmount(amount, reason = 'update', actor = null) {
        const config = await this.getLotteryConfig();
        const cappedAmount = Math.min(amount, config.jackpot.capUSDT);

        await query(`
            INSERT INTO jackpot_status (jackpot_amount, reason, actor_address, updated_at)
            VALUES ($1, $2, $3, NOW())
        `, [cappedAmount, reason, actor]);

        return {
            amount: cappedAmount,
            wasCapped: amount > config.jackpot.capUSDT,
            overflow: Math.max(0, amount - config.jackpot.capUSDT)
        };
    }

    /**
     * Get jackpot history
     */
    static async getJackpotHistory(limit = 50) {
        const result = await query(`
            SELECT * FROM jackpot_status
            ORDER BY updated_at DESC
            LIMIT $1
        `, [limit]);

        return result.rows;
    }

    /**
     * Get configuration history for audit
     */
    static async getConfigHistory(key = null, limit = 100) {
        let queryText = `
            SELECT * FROM prize_config_history
            ORDER BY changed_at DESC
            LIMIT $1
        `;
        const values = [limit];

        if (key) {
            queryText = `
                SELECT * FROM prize_config_history
                WHERE key = $2
                ORDER BY changed_at DESC
                LIMIT $1
            `;
            values.push(key);
        }

        const result = await query(queryText, values);
        return result.rows;
    }
}

module.exports = PrizeConfig;
