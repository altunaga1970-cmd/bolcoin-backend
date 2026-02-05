const { query, getClient } = require('../config/database');

// =================================
// AUDIT SERVICE
// Reportes de auditoria financiera
// =================================

/**
 * Obtener reporte de auditoria completo
 */
async function getAuditReport(dateFrom = null, dateTo = null) {
    const from = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = dateTo || new Date();

    // Ingresos (apuestas)
    const income = await query(`
        SELECT
            COALESCE(SUM(amount), 0) as total_bets,
            COUNT(*) as bet_count
        FROM bets
        WHERE created_at >= $1 AND created_at <= $2
        AND is_corrido_child = false
    `, [from, to]);

    // Egresos (premios pagados)
    const expenses = await query(`
        SELECT
            COALESCE(SUM(actual_payout), 0) as total_prizes
        FROM bets
        WHERE processed_at >= $1 AND processed_at <= $2
        AND status = 'won'
    `, [from, to]);

    // Fees del operador
    const fees = await query(`
        SELECT COALESCE(SUM(fee_amount), 0) as total_fees
        FROM operator_fees
        WHERE created_at >= $1 AND created_at <= $2
    `, [from, to]);

    // Comisiones de referidos
    const commissions = await query(`
        SELECT
            COALESCE(SUM(commission_amount), 0) as total_commissions,
            COUNT(*) as commission_count
        FROM referral_commissions
        WHERE created_at >= $1 AND created_at <= $2
    `, [from, to]);

    // Desglose por tipo de juego
    const byGameType = await query(`
        SELECT
            game_type,
            COUNT(*) as bet_count,
            COALESCE(SUM(amount), 0) as total_wagered,
            COALESCE(SUM(actual_payout), 0) as total_paid
        FROM bets
        WHERE created_at >= $1 AND created_at <= $2
        AND is_corrido_child = false
        GROUP BY game_type
        ORDER BY total_wagered DESC
    `, [from, to]);

    const totalIncome = parseFloat(income.rows[0].total_bets);
    const totalExpenses = parseFloat(expenses.rows[0].total_prizes) +
                         parseFloat(commissions.rows[0].total_commissions);
    const operatorFees = parseFloat(fees.rows[0].total_fees);

    return {
        period: {
            from,
            to
        },
        income: {
            totalBets: totalIncome,
            betCount: parseInt(income.rows[0].bet_count)
        },
        expenses: {
            totalPrizes: parseFloat(expenses.rows[0].total_prizes),
            totalCommissions: parseFloat(commissions.rows[0].total_commissions),
            commissionCount: parseInt(commissions.rows[0].commission_count),
            total: totalExpenses
        },
        fees: {
            operatorFees
        },
        netProfit: totalIncome - totalExpenses,
        grossProfit: totalIncome - parseFloat(expenses.rows[0].total_prizes),
        byGameType: byGameType.rows.map(row => ({
            gameType: row.game_type,
            betCount: parseInt(row.bet_count),
            totalWagered: parseFloat(row.total_wagered),
            totalPaid: parseFloat(row.total_paid),
            profit: parseFloat(row.total_wagered) - parseFloat(row.total_paid)
        }))
    };
}

/**
 * Obtener desglose de ingresos vs egresos por dia
 */
async function getIncomeExpensesBreakdown(dateFrom = null, dateTo = null) {
    const from = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = dateTo || new Date();

    const result = await query(`
        SELECT
            date,
            total_amount_wagered as income,
            total_prizes_paid as prizes,
            referral_commissions_paid as commissions,
            fees_collected as fees,
            net_profit
        FROM daily_metrics
        WHERE date >= $1 AND date <= $2
        ORDER BY date ASC
    `, [from, to]);

    return {
        period: { from, to },
        data: result.rows.map(row => ({
            date: row.date,
            income: parseFloat(row.income) || 0,
            prizes: parseFloat(row.prizes) || 0,
            commissions: parseFloat(row.commissions) || 0,
            fees: parseFloat(row.fees) || 0,
            netProfit: parseFloat(row.net_profit) || 0
        })),
        totals: result.rows.reduce((acc, row) => ({
            income: acc.income + parseFloat(row.income || 0),
            prizes: acc.prizes + parseFloat(row.prizes || 0),
            commissions: acc.commissions + parseFloat(row.commissions || 0),
            fees: acc.fees + parseFloat(row.fees || 0),
            netProfit: acc.netProfit + parseFloat(row.net_profit || 0)
        }), { income: 0, prizes: 0, commissions: 0, fees: 0, netProfit: 0 })
    };
}

/**
 * Obtener balance general del sistema
 */
async function getGeneralBalance() {
    const client = await getClient();

    try {
        // Total apostado historico
        const totalBets = await client.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM bets
            WHERE is_corrido_child = false
        `);

        // Total premios pagados
        const totalPrizes = await client.query(`
            SELECT COALESCE(SUM(actual_payout), 0) as total
            FROM bets
            WHERE status = 'won'
        `);

        // Total comisiones pagadas
        const totalCommissions = await client.query(`
            SELECT COALESCE(SUM(commission_amount), 0) as total
            FROM referral_commissions
            WHERE status = 'paid'
        `);

        // Total fees
        const totalFees = await client.query(`
            SELECT COALESCE(SUM(fee_amount), 0) as total
            FROM operator_fees
        `);

        // Balances de usuarios
        const userBalances = await client.query(`
            SELECT
                COALESCE(SUM(balance), 0) as total_balance,
                COUNT(*) as user_count
            FROM users
            WHERE balance > 0
        `);

        // Sorteos activos con apuestas pendientes
        const pendingBets = await client.query(`
            SELECT COALESCE(SUM(b.amount), 0) as total
            FROM bets b
            JOIN draws d ON b.draw_id = d.id
            WHERE d.status IN ('scheduled', 'open', 'closed')
            AND b.status = 'pending'
        `);

        const bets = parseFloat(totalBets.rows[0].total);
        const prizes = parseFloat(totalPrizes.rows[0].total);
        const commissions = parseFloat(totalCommissions.rows[0].total);
        const fees = parseFloat(totalFees.rows[0].total);

        return {
            historicTotals: {
                totalBets: bets,
                totalPrizes: prizes,
                totalCommissions: commissions,
                totalFees: fees,
                grossProfit: bets - prizes,
                netProfit: bets - prizes - commissions
            },
            currentState: {
                userBalances: parseFloat(userBalances.rows[0].total_balance),
                usersWithBalance: parseInt(userBalances.rows[0].user_count),
                pendingBetsAmount: parseFloat(pendingBets.rows[0].total)
            },
            healthCheck: {
                isHealthy: (bets - prizes - commissions) >= 0,
                profitMargin: bets > 0 ? ((bets - prizes) / bets * 100).toFixed(2) : 0
            }
        };
    } finally {
        client.release();
    }
}

/**
 * Exportar reporte de auditoria a formato para CSV
 */
async function exportAuditReport(dateFrom, dateTo, format = 'detailed') {
    const from = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = dateTo || new Date();

    if (format === 'summary') {
        const report = await getAuditReport(from, to);
        return {
            headers: ['Concepto', 'Valor'],
            rows: [
                ['Periodo', `${from.toISOString().split('T')[0]} a ${to.toISOString().split('T')[0]}`],
                ['Total Apostado', report.income.totalBets],
                ['Cantidad de Apuestas', report.income.betCount],
                ['Total Premios Pagados', report.expenses.totalPrizes],
                ['Total Comisiones Referidos', report.expenses.totalCommissions],
                ['Fees Operador', report.fees.operatorFees],
                ['Ganancia Bruta', report.grossProfit],
                ['Ganancia Neta', report.netProfit]
            ]
        };
    }

    // Formato detallado - por dia
    const breakdown = await getIncomeExpensesBreakdown(from, to);
    return {
        headers: ['Fecha', 'Ingresos', 'Premios', 'Comisiones', 'Fees', 'Ganancia Neta'],
        rows: breakdown.data.map(row => [
            row.date,
            row.income,
            row.prizes,
            row.commissions,
            row.fees,
            row.netProfit
        ])
    };
}

/**
 * Obtener transacciones para auditoria
 */
async function getAuditTransactions({ page = 1, limit = 100, type = null, dateFrom = null, dateTo = null }) {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (type) {
        whereClause += ` AND t.transaction_type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
    }

    if (dateFrom) {
        whereClause += ` AND t.created_at >= $${paramIndex}`;
        params.push(dateFrom);
        paramIndex++;
    }

    if (dateTo) {
        whereClause += ` AND t.created_at <= $${paramIndex}`;
        params.push(dateTo);
        paramIndex++;
    }

    // Contar total
    const countResult = await query(`
        SELECT COUNT(*) FROM transactions t ${whereClause}
    `, params);

    // Obtener transacciones
    const result = await query(`
        SELECT
            t.id,
            t.user_id,
            u.wallet_address,
            t.transaction_type,
            t.amount,
            t.balance_before,
            t.balance_after,
            t.reference_type,
            t.reference_id,
            t.description,
            t.created_at
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    return {
        transactions: result.rows,
        pagination: {
            page,
            limit,
            total: parseInt(countResult.rows[0].count),
            totalPages: Math.ceil(countResult.rows[0].count / limit)
        }
    };
}

/**
 * Obtener resumen de fees del operador
 */
async function getOperatorFeesReport(dateFrom = null, dateTo = null) {
    const from = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = dateTo || new Date();

    // Por dia
    const daily = await query(`
        SELECT
            DATE(created_at) as date,
            COUNT(*) as transaction_count,
            COALESCE(SUM(fee_amount), 0) as total_fees
        FROM operator_fees
        WHERE created_at >= $1 AND created_at <= $2
        GROUP BY DATE(created_at)
        ORDER BY date DESC
    `, [from, to]);

    // Totales
    const totals = await query(`
        SELECT
            COUNT(*) as transaction_count,
            COALESCE(SUM(fee_amount), 0) as total_fees,
            COALESCE(AVG(fee_amount), 0) as avg_fee
        FROM operator_fees
        WHERE created_at >= $1 AND created_at <= $2
    `, [from, to]);

    return {
        period: { from, to },
        daily: daily.rows.map(row => ({
            date: row.date,
            transactionCount: parseInt(row.transaction_count),
            totalFees: parseFloat(row.total_fees)
        })),
        totals: {
            transactionCount: parseInt(totals.rows[0].transaction_count),
            totalFees: parseFloat(totals.rows[0].total_fees),
            avgFee: parseFloat(totals.rows[0].avg_fee)
        }
    };
}

module.exports = {
    getAuditReport,
    getIncomeExpensesBreakdown,
    getGeneralBalance,
    exportAuditReport,
    getAuditTransactions,
    getOperatorFeesReport
};
