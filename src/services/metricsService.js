const { query, getClient } = require('../config/database');

// =================================
// METRICS SERVICE
// Calculo y gestion de metricas financieras
// =================================

/**
 * Obtener metricas del dashboard segun el periodo
 * @param {string} period - 'daily', 'monthly', 'yearly'
 * @param {Date} dateFrom - Fecha inicio (opcional)
 * @param {Date} dateTo - Fecha fin (opcional)
 */
async function getDashboardMetrics(period = 'daily', dateFrom = null, dateTo = null) {
    let metrics;

    switch (period) {
        case 'daily':
            metrics = await getDailyMetrics(dateFrom, dateTo);
            break;
        case 'monthly':
            metrics = await getMonthlyMetrics(dateFrom, dateTo);
            break;
        case 'yearly':
            metrics = await getYearlyMetrics();
            break;
        default:
            metrics = await getDailyMetrics(dateFrom, dateTo);
    }

    return metrics;
}

/**
 * Obtener metricas diarias
 */
async function getDailyMetrics(dateFrom = null, dateTo = null) {
    const from = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // ultimos 30 dias
    const to = dateTo || new Date();

    const result = await query(`
        SELECT
            date,
            total_numbers_played,
            total_amount_wagered,
            total_transactions,
            total_prizes_paid,
            fees_collected,
            net_profit,
            referral_commissions_paid,
            unique_wallets
        FROM daily_metrics
        WHERE date >= $1 AND date <= $2
        ORDER BY date DESC
    `, [from, to]);

    return {
        period: 'daily',
        data: result.rows,
        summary: calculateSummary(result.rows)
    };
}

/**
 * Obtener metricas mensuales
 */
async function getMonthlyMetrics(dateFrom = null, dateTo = null) {
    const currentYear = new Date().getFullYear();
    const fromYear = dateFrom ? dateFrom.getFullYear() : currentYear;
    const toYear = dateTo ? dateTo.getFullYear() : currentYear;

    const result = await query(`
        SELECT
            year,
            month,
            total_numbers_played,
            total_amount_wagered,
            total_transactions,
            total_prizes_paid,
            fees_collected,
            net_profit,
            referral_commissions_paid,
            unique_wallets
        FROM monthly_metrics
        WHERE year >= $1 AND year <= $2
        ORDER BY year DESC, month DESC
    `, [fromYear, toYear]);

    return {
        period: 'monthly',
        data: result.rows,
        summary: calculateSummary(result.rows)
    };
}

/**
 * Obtener metricas anuales (agregacion de monthly_metrics)
 */
async function getYearlyMetrics() {
    const result = await query(`
        SELECT
            year,
            SUM(total_numbers_played) as total_numbers_played,
            SUM(total_amount_wagered) as total_amount_wagered,
            SUM(total_transactions) as total_transactions,
            SUM(total_prizes_paid) as total_prizes_paid,
            SUM(fees_collected) as fees_collected,
            SUM(net_profit) as net_profit,
            SUM(referral_commissions_paid) as referral_commissions_paid,
            SUM(unique_wallets) as unique_wallets
        FROM monthly_metrics
        GROUP BY year
        ORDER BY year DESC
    `);

    return {
        period: 'yearly',
        data: result.rows,
        summary: calculateSummary(result.rows)
    };
}

/**
 * Obtener resumen general del dashboard
 */
async function getDashboardSummary() {
    // Metricas de hoy - La Bolita (en tiempo real de la BD)
    const todayBolita = await query(`
        SELECT
            COUNT(*) FILTER (WHERE is_corrido_child = false) as numbers_played,
            COALESCE(SUM(amount) FILTER (WHERE is_corrido_child = false), 0) as amount_wagered,
            COUNT(DISTINCT user_id) as unique_users
        FROM bets
        WHERE DATE(created_at) = CURRENT_DATE
    `);

    // Metricas de hoy - La Fortuna (lottery tickets)
    const todayLottery = await query(`
        SELECT
            COUNT(*) as tickets_count,
            COALESCE(SUM(price), 0) as amount_wagered,
            COUNT(DISTINCT user_address) as unique_users
        FROM lottery_tickets
        WHERE DATE(purchased_at) = CURRENT_DATE
    `);

    const todayTransactions = await query(`
        SELECT COUNT(*) as count
        FROM transactions
        WHERE DATE(created_at) = CURRENT_DATE
    `);

    // Premios pagados hoy - La Bolita
    const todayPrizesBolita = await query(`
        SELECT COALESCE(SUM(actual_payout), 0) as total
        FROM bets
        WHERE DATE(processed_at) = CURRENT_DATE AND status = 'won'
    `);

    // Premios pagados hoy - La Fortuna
    const todayPrizesLottery = await query(`
        SELECT COALESCE(SUM(prize_amount), 0) as total
        FROM lottery_tickets
        WHERE DATE(claimed_at) = CURRENT_DATE AND status = 'claimed'
    `);

    const todayPrizes = {
        rows: [{
            total: parseFloat(todayPrizesBolita.rows[0].total) + parseFloat(todayPrizesLottery.rows[0].total)
        }]
    };

    // Combinar resultados
    const todayResult = {
        rows: [{
            numbers_played: parseInt(todayBolita.rows[0].numbers_played) + parseInt(todayLottery.rows[0].tickets_count),
            amount_wagered: parseFloat(todayBolita.rows[0].amount_wagered) + parseFloat(todayLottery.rows[0].amount_wagered),
            unique_users: parseInt(todayBolita.rows[0].unique_users) + parseInt(todayLottery.rows[0].unique_users)
        }]
    };

    // Metricas del mes actual
    const monthResult = await query(`
        SELECT
            COALESCE(SUM(total_amount_wagered), 0) as amount_wagered,
            COALESCE(SUM(total_prizes_paid), 0) as prizes_paid,
            COALESCE(SUM(net_profit), 0) as net_profit,
            COALESCE(SUM(total_transactions), 0) as transactions
        FROM daily_metrics
        WHERE EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
        AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
    `);

    // Comparacion con mes anterior
    const lastMonthResult = await query(`
        SELECT
            COALESCE(SUM(total_amount_wagered), 0) as amount_wagered,
            COALESCE(SUM(net_profit), 0) as net_profit
        FROM daily_metrics
        WHERE date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND date < DATE_TRUNC('month', CURRENT_DATE)
    `);

    const today = todayResult.rows[0];
    const month = monthResult.rows[0];
    const lastMonth = lastMonthResult.rows[0];

    // Calcular cambio porcentual
    const wagerChange = lastMonth.amount_wagered > 0
        ? ((month.amount_wagered - lastMonth.amount_wagered) / lastMonth.amount_wagered * 100).toFixed(1)
        : 0;

    const profitChange = lastMonth.net_profit > 0
        ? ((month.net_profit - lastMonth.net_profit) / lastMonth.net_profit * 100).toFixed(1)
        : 0;

    return {
        today: {
            numbersPlayed: parseInt(today.numbers_played) || 0,
            amountWagered: parseFloat(today.amount_wagered) || 0,
            transactions: parseInt(todayTransactions.rows[0].count) || 0,
            prizesPaid: parseFloat(todayPrizes.rows[0].total) || 0,
            uniqueUsers: parseInt(today.unique_users) || 0
        },
        thisMonth: {
            amountWagered: parseFloat(month.amount_wagered) || 0,
            prizesPaid: parseFloat(month.prizes_paid) || 0,
            netProfit: parseFloat(month.net_profit) || 0,
            transactions: parseInt(month.transactions) || 0
        },
        changes: {
            wagerChange: parseFloat(wagerChange),
            profitChange: parseFloat(profitChange)
        }
    };
}

/**
 * Obtener datos para graficos
 */
async function getChartData(period = 'daily', days = 30) {
    let chartData;

    if (period === 'daily') {
        const result = await query(`
            SELECT
                date,
                total_amount_wagered as wagered,
                total_prizes_paid as prizes,
                net_profit as profit,
                total_transactions as transactions
            FROM daily_metrics
            WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
            ORDER BY date ASC
        `);
        chartData = result.rows;
    } else if (period === 'monthly') {
        const result = await query(`
            SELECT
                year || '-' || LPAD(month::text, 2, '0') as date,
                total_amount_wagered as wagered,
                total_prizes_paid as prizes,
                net_profit as profit,
                total_transactions as transactions
            FROM monthly_metrics
            ORDER BY year DESC, month DESC
            LIMIT 12
        `);
        chartData = result.rows.reverse();
    }

    return {
        labels: chartData.map(d => d.date),
        datasets: {
            wagered: chartData.map(d => parseFloat(d.wagered) || 0),
            prizes: chartData.map(d => parseFloat(d.prizes) || 0),
            profit: chartData.map(d => parseFloat(d.profit) || 0),
            transactions: chartData.map(d => parseInt(d.transactions) || 0)
        }
    };
}

/**
 * Agregar metricas del dia actual a daily_metrics
 */
async function aggregateTodayMetrics() {
    await query(`SELECT aggregate_daily_metrics(CURRENT_DATE)`);
}

/**
 * Agregar metricas de un dia especifico
 */
async function aggregateDayMetrics(date) {
    await query(`SELECT aggregate_daily_metrics($1)`, [date]);
}

/**
 * Agregar metricas mensuales
 */
async function aggregateMonthMetrics(year, month) {
    await query(`SELECT aggregate_monthly_metrics($1, $2)`, [year, month]);
}

/**
 * Calcular resumen de un array de metricas
 */
function calculateSummary(data) {
    if (!data || data.length === 0) {
        return {
            totalWagered: 0,
            totalPrizes: 0,
            totalProfit: 0,
            totalTransactions: 0,
            avgDailyWager: 0
        };
    }

    const totals = data.reduce((acc, row) => ({
        wagered: acc.wagered + parseFloat(row.total_amount_wagered || 0),
        prizes: acc.prizes + parseFloat(row.total_prizes_paid || 0),
        profit: acc.profit + parseFloat(row.net_profit || 0),
        transactions: acc.transactions + parseInt(row.total_transactions || 0)
    }), { wagered: 0, prizes: 0, profit: 0, transactions: 0 });

    return {
        totalWagered: totals.wagered,
        totalPrizes: totals.prizes,
        totalProfit: totals.profit,
        totalTransactions: totals.transactions,
        avgDailyWager: totals.wagered / data.length
    };
}

/**
 * Obtener metricas en tiempo real (sin usar tablas agregadas)
 */
async function getRealTimeMetrics() {
    const client = await getClient();

    try {
        // Total apostado hoy - La Bolita
        const betsToday = await client.query(`
            SELECT
                COUNT(*) FILTER (WHERE is_corrido_child = false) as count,
                COALESCE(SUM(amount) FILTER (WHERE is_corrido_child = false), 0) as total
            FROM bets
            WHERE DATE(created_at) = CURRENT_DATE
        `);

        // Total apostado hoy - La Fortuna
        const lotteryToday = await client.query(`
            SELECT
                COUNT(*) as count,
                COALESCE(SUM(price), 0) as total
            FROM lottery_tickets
            WHERE DATE(purchased_at) = CURRENT_DATE
        `);

        // Premios pagados hoy - La Bolita
        const prizesTodayBolita = await client.query(`
            SELECT COALESCE(SUM(actual_payout), 0) as total
            FROM bets
            WHERE DATE(processed_at) = CURRENT_DATE AND status = 'won'
        `);

        // Premios pagados hoy - La Fortuna
        const prizesTodayLottery = await client.query(`
            SELECT COALESCE(SUM(prize_amount), 0) as total
            FROM lottery_tickets
            WHERE DATE(claimed_at) = CURRENT_DATE AND status = 'claimed'
        `);

        // Fees de hoy
        const feesToday = await client.query(`
            SELECT COALESCE(SUM(fee_amount), 0) as total
            FROM operator_fees
            WHERE DATE(created_at) = CURRENT_DATE
        `);

        // Comisiones de referidos de hoy
        const commissionsToday = await client.query(`
            SELECT COALESCE(SUM(commission_amount), 0) as total
            FROM referral_commissions
            WHERE DATE(created_at) = CURRENT_DATE
        `);

        const bolitaWagered = parseFloat(betsToday.rows[0].total);
        const lotteryWagered = parseFloat(lotteryToday.rows[0].total);
        const wagered = bolitaWagered + lotteryWagered;

        const bolitaPrizes = parseFloat(prizesTodayBolita.rows[0].total);
        const lotteryPrizes = parseFloat(prizesTodayLottery.rows[0].total);
        const prizes = bolitaPrizes + lotteryPrizes;

        const fees = parseFloat(feesToday.rows[0].total);
        const commissions = parseFloat(commissionsToday.rows[0].total);

        return {
            betsCount: parseInt(betsToday.rows[0].count) + parseInt(lotteryToday.rows[0].count),
            totalWagered: wagered,
            totalPrizes: prizes,
            totalFees: fees,
            totalCommissions: commissions,
            netProfit: wagered - prizes - commissions,
            timestamp: new Date(),
            breakdown: {
                bolita: {
                    count: parseInt(betsToday.rows[0].count),
                    wagered: bolitaWagered,
                    prizes: bolitaPrizes
                },
                lottery: {
                    count: parseInt(lotteryToday.rows[0].count),
                    wagered: lotteryWagered,
                    prizes: lotteryPrizes
                }
            }
        };
    } finally {
        client.release();
    }
}

module.exports = {
    getDashboardMetrics,
    getDailyMetrics,
    getMonthlyMetrics,
    getYearlyMetrics,
    getDashboardSummary,
    getChartData,
    aggregateTodayMetrics,
    aggregateDayMetrics,
    aggregateMonthMetrics,
    getRealTimeMetrics
};
