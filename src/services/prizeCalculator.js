const {
    LOTTERY_CONFIG,
    BOLITA_CONFIG,
    calculateFromBps,
    getCategoryInfo,
    getAllCategories
} = require('../config/prizeConfig');
const { query } = require('../config/database');

// =================================
// PRIZE CALCULATOR SERVICE
// =================================

class PrizeCalculator {
    // =================================
    // LA FORTUNA (LOTTERY) CALCULATIONS
    // Sistema de 5 categorías con premios proporcionales
    // =================================

    /**
     * Calculate prize distribution for a lottery draw
     * Distribución directa del total recaudado:
     * - 20% Jackpot (cat 1: 6+clave)
     * - 40% Cat 2 (6 aciertos)
     * - 5% Cat 3 (5 aciertos)
     * - 3% Cat 4 (4 aciertos)
     * - 6% Cat 5 (3 aciertos)
     * - 6% Fee operador
     * - 20% Reservas
     */
    static calculateLotteryDistribution(totalTicketSales, currentJackpot, winnersByCategory = {}) {
        const distribution = LOTTERY_CONFIG.revenueDistribution;

        // Calculate revenue portions
        const toJackpot = calculateFromBps(totalTicketSales, distribution.jackpotBps);   // 20%
        const toCat6 = calculateFromBps(totalTicketSales, distribution.cat6Bps);         // 40%
        const toCat5 = calculateFromBps(totalTicketSales, distribution.cat5Bps);         // 5%
        const toCat4 = calculateFromBps(totalTicketSales, distribution.cat4Bps);         // 3%
        const toCat3 = calculateFromBps(totalTicketSales, distribution.cat3Bps);         // 6%
        const toOperator = calculateFromBps(totalTicketSales, distribution.operatorBps); // 6%
        const toReserve = calculateFromBps(totalTicketSales, distribution.reserveBps);   // 20%

        // Handle jackpot cap ($1M)
        let actualToJackpot = toJackpot;
        let jackpotOverflow = 0;
        const newJackpot = currentJackpot + toJackpot;

        if (newJackpot > LOTTERY_CONFIG.jackpot.capUSDT) {
            actualToJackpot = Math.max(0, LOTTERY_CONFIG.jackpot.capUSDT - currentJackpot);
            jackpotOverflow = toJackpot - actualToJackpot;
        }

        // Calculate prizes by category
        const categoryPrizes = this.calculateCategoryPrizes(
            totalTicketSales,
            currentJackpot + actualToJackpot,
            winnersByCategory
        );

        return {
            revenue: {
                totalSales: totalTicketSales,
                toJackpot: actualToJackpot,
                jackpotOverflow,
                toCat6,
                toCat5,
                toCat4,
                toCat3,
                toOperator,
                toReserve
            },
            jackpot: {
                previous: currentJackpot,
                contribution: actualToJackpot,
                new: currentJackpot + actualToJackpot,
                capped: newJackpot >= LOTTERY_CONFIG.jackpot.capUSDT
            },
            prizes: categoryPrizes
        };
    }

    /**
     * Calculate prizes for each category (1-5)
     * Los premios se reparten proporcionalmente entre los ganadores
     */
    static calculateCategoryPrizes(totalPool, jackpotAmount, winnersByCategory = {}) {
        const prizes = {};
        const categoryBps = {
            1: 'jackpot',
            2: LOTTERY_CONFIG.revenueDistribution.cat6Bps,   // 4000 (40%)
            3: LOTTERY_CONFIG.revenueDistribution.cat5Bps,   // 500 (5%)
            4: LOTTERY_CONFIG.revenueDistribution.cat4Bps,   // 300 (3%)
            5: LOTTERY_CONFIG.revenueDistribution.cat3Bps    // 600 (6%)
        };

        let totalPayout = 0;

        for (let cat = 1; cat <= 5; cat++) {
            const categoryInfo = getCategoryInfo(cat);
            const winnersCount = winnersByCategory[cat] || 0;

            let poolAllocation, prizePerWinner;

            if (cat === 1) {
                // Jackpot
                poolAllocation = jackpotAmount;
                prizePerWinner = winnersCount > 0 ? jackpotAmount / winnersCount : jackpotAmount;
            } else {
                // Otras categorías: porcentaje del total
                poolAllocation = calculateFromBps(totalPool, categoryBps[cat]);
                prizePerWinner = winnersCount > 0 ? poolAllocation / winnersCount : 0;
            }

            // Redondear a 2 decimales
            prizePerWinner = Math.floor(prizePerWinner * 100) / 100;
            const categoryPayout = winnersCount > 0 ? prizePerWinner * winnersCount : 0;
            totalPayout += categoryPayout;

            prizes[cat] = {
                category: cat,
                ...categoryInfo,
                poolShareBps: categoryBps[cat],
                poolAllocation,
                winnersCount,
                prizePerWinner,
                totalPayout: categoryPayout,
                jackpotReset: cat === 1 && winnersCount > 0
            };
        }

        // Add summary
        prizes.summary = {
            totalPool,
            totalPayout,
            jackpotAmount,
            excessToReserve: 0 // En este sistema no hay exceso, todo se reparte
        };

        return prizes;
    }

    /**
     * Get estimated prizes for display (no winners yet)
     * Muestra lo que un ganador recibiría si fuera el único
     */
    static getEstimatedPrizes(estimatedSales, currentJackpot) {
        const categories = getAllCategories();

        return categories.map(cat => {
            if (cat.category === 1) {
                return {
                    ...cat,
                    estimatedPrize: currentJackpot,
                    isJackpot: true,
                    note: 'Jackpot progresivo'
                };
            }

            // Calcular premio si hubiera 1 solo ganador
            const poolShare = calculateFromBps(estimatedSales, cat.poolShareBps);
            return {
                ...cat,
                poolShareEstimate: poolShare,
                estimatedPrize: poolShare,
                note: 'A repartir entre ganadores'
            };
        });
    }

    // =================================
    // LA BOLITA CALCULATIONS
    // =================================

    /**
     * Calculate payout for a winning bet
     * @param {string} gameType - fijos, centenas, parles
     * @param {number} betAmount - Bet amount in USDT
     * @returns {Object} Payout breakdown
     */
    static calculateBolitaPayout(gameType, betAmount) {
        const config = BOLITA_CONFIG.multipliers[gameType];
        if (!config) {
            throw new Error(`Invalid game type: ${gameType}`);
        }

        const rawPayout = calculateFromBps(betAmount, config.bps);
        const cappedPayout = Math.min(rawPayout, config.maxPayoutUSDT);

        return {
            gameType,
            betAmount,
            multiplier: config.bps / 100,
            rawPayout,
            cappedPayout,
            wasCapped: rawPayout > config.maxPayoutUSDT,
            maxPayout: config.maxPayoutUSDT
        };
    }

    /**
     * Calculate risk exposure for a draw
     * @param {number} drawId - Draw ID
     * @returns {Object} Risk assessment
     */
    static async calculateDrawExposure(drawId) {
        // Get all active bets for this draw
        const betsResult = await query(`
            SELECT game_type, number, SUM(amount) as total_bet
            FROM bets
            WHERE draw_id = $1 AND status = 'pending'
            GROUP BY game_type, number
            ORDER BY total_bet DESC
        `, [drawId]);

        const bets = betsResult.rows;
        let totalExposure = 0;
        const exposureByNumber = {};

        for (const bet of bets) {
            const payout = this.calculateBolitaPayout(bet.game_type, parseFloat(bet.total_bet));
            const exposure = payout.cappedPayout;

            totalExposure += exposure;
            exposureByNumber[`${bet.game_type}:${bet.number}`] = {
                gameType: bet.game_type,
                number: bet.number,
                totalBet: parseFloat(bet.total_bet),
                potentialPayout: exposure
            };
        }

        // Get draw limit
        const maxPayout = BOLITA_CONFIG.limits.maxTotalPayoutPerDraw;

        return {
            drawId,
            totalPotentialExposure: totalExposure,
            maxAllowedPayout: maxPayout,
            riskLevel: totalExposure > maxPayout ? 'HIGH' :
                       totalExposure > maxPayout * 0.7 ? 'MEDIUM' : 'LOW',
            topExposures: Object.values(exposureByNumber)
                .sort((a, b) => b.potentialPayout - a.potentialPayout)
                .slice(0, 10),
            betCount: bets.length
        };
    }

    /**
     * Calculate draw revenue distribution
     * @param {number} totalBets - Total bet amount
     * @returns {Object} Revenue breakdown
     */
    static calculateBolitaRevenue(totalBets) {
        const dist = BOLITA_CONFIG.revenueDistribution;

        return {
            totalBets,
            toPrizePool: calculateFromBps(totalBets, dist.prizepoolBps),
            toOperator: calculateFromBps(totalBets, dist.operatorBps),
            toReserve: calculateFromBps(totalBets, dist.reserveBps)
        };
    }

    // =================================
    // JACKPOT MANAGEMENT
    // =================================

    /**
     * Get current jackpot status
     * @returns {Object} Jackpot info
     */
    static async getJackpotStatus() {
        // Get latest jackpot amount from database
        const result = await query(`
            SELECT jackpot_amount, updated_at
            FROM jackpot_status
            ORDER BY updated_at DESC
            LIMIT 1
        `);

        const currentAmount = result.rows[0]?.jackpot_amount || LOTTERY_CONFIG.jackpot.minStartUSDT;
        const cap = LOTTERY_CONFIG.jackpot.capUSDT;

        return {
            currentAmount,
            cap,
            percentOfCap: (currentAmount / cap) * 100,
            isCapped: currentAmount >= cap,
            nextContributionRate: `${LOTTERY_CONFIG.revenueDistribution.jackpotBps / 100}%`,
            minStart: LOTTERY_CONFIG.jackpot.minStartUSDT
        };
    }

    /**
     * Update jackpot amount
     * @param {number} newAmount - New jackpot amount
     * @param {string} reason - Reason for update
     */
    static async updateJackpot(newAmount, reason = 'contribution') {
        const capped = Math.min(newAmount, LOTTERY_CONFIG.jackpot.capUSDT);

        await query(`
            INSERT INTO jackpot_status (jackpot_amount, reason, updated_at)
            VALUES ($1, $2, NOW())
        `, [capped, reason]);

        return {
            newAmount: capped,
            wasCapped: newAmount > LOTTERY_CONFIG.jackpot.capUSDT,
            overflow: Math.max(0, newAmount - LOTTERY_CONFIG.jackpot.capUSDT)
        };
    }

    /**
     * Reset jackpot after win
     */
    static async resetJackpot() {
        const minStart = LOTTERY_CONFIG.jackpot.minStartUSDT;
        await this.updateJackpot(minStart, 'jackpot_won_reset');
        return minStart;
    }
}

module.exports = PrizeCalculator;
