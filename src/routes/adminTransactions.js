const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/adminAuth');

// =================================
// RUTAS DE TRANSACCIONES ADMIN
// =================================

router.use(requireAdmin);

/**
 * GET /api/admin/transactions
 * Listar transacciones con filtros
 * Query params: wallet, type, date_from, date_to, page, limit
 */
router.get('/', async (req, res) => {
    try {
        const {
            wallet,
            type,
            date_from,
            date_to,
            page = 1,
            limit = 50
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramIndex = 1;

        if (wallet) {
            whereClause += ` AND u.wallet_address ILIKE $${paramIndex}`;
            params.push(`%${wallet}%`);
            paramIndex++;
        }

        if (type) {
            whereClause += ` AND t.transaction_type = $${paramIndex}`;
            params.push(type);
            paramIndex++;
        }

        if (date_from) {
            whereClause += ` AND t.created_at >= $${paramIndex}`;
            params.push(new Date(date_from));
            paramIndex++;
        }

        if (date_to) {
            whereClause += ` AND t.created_at <= $${paramIndex}`;
            params.push(new Date(date_to));
            paramIndex++;
        }

        // Contar total
        const countResult = await query(`
            SELECT COUNT(*)
            FROM transactions t
            LEFT JOIN users u ON t.user_id = u.id
            ${whereClause}
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
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: {
                transactions: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].count),
                    totalPages: Math.ceil(countResult.rows[0].count / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Error listando transacciones:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener transacciones'
        });
    }
});

/**
 * GET /api/admin/transactions/bets
 * Listar apuestas con filtros extendidos
 */
router.get('/bets', async (req, res) => {
    try {
        const {
            wallet,
            draw_id,
            status,
            game_type,
            date_from,
            date_to,
            page = 1,
            limit = 50
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        let whereClause = 'WHERE b.is_corrido_child = false';
        const params = [];
        let paramIndex = 1;

        if (wallet) {
            whereClause += ` AND u.wallet_address ILIKE $${paramIndex}`;
            params.push(`%${wallet}%`);
            paramIndex++;
        }

        if (draw_id) {
            whereClause += ` AND b.draw_id = $${paramIndex}`;
            params.push(parseInt(draw_id));
            paramIndex++;
        }

        if (status) {
            whereClause += ` AND b.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }

        if (game_type) {
            whereClause += ` AND b.game_type = $${paramIndex}`;
            params.push(game_type);
            paramIndex++;
        }

        if (date_from) {
            whereClause += ` AND b.created_at >= $${paramIndex}`;
            params.push(new Date(date_from));
            paramIndex++;
        }

        if (date_to) {
            whereClause += ` AND b.created_at <= $${paramIndex}`;
            params.push(new Date(date_to));
            paramIndex++;
        }

        // Contar total
        const countResult = await query(`
            SELECT COUNT(*)
            FROM bets b
            LEFT JOIN users u ON b.user_id = u.id
            ${whereClause}
        `, params);

        // Obtener apuestas
        const result = await query(`
            SELECT
                b.id,
                b.user_id,
                u.wallet_address,
                b.draw_id,
                d.draw_number,
                b.game_type,
                b.bet_number,
                b.amount,
                b.potential_payout,
                b.multiplier,
                b.status,
                b.actual_payout,
                b.created_at,
                b.processed_at
            FROM bets b
            LEFT JOIN users u ON b.user_id = u.id
            LEFT JOIN draws d ON b.draw_id = d.id
            ${whereClause}
            ORDER BY b.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: {
                bets: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].count),
                    totalPages: Math.ceil(countResult.rows[0].count / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Error listando apuestas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener apuestas'
        });
    }
});

/**
 * GET /api/admin/transactions/prizes
 * Listar premios cobrados
 */
router.get('/prizes', async (req, res) => {
    try {
        const {
            wallet,
            date_from,
            date_to,
            page = 1,
            limit = 50
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        let whereClause = "WHERE b.status = 'won' AND b.actual_payout > 0";
        const params = [];
        let paramIndex = 1;

        if (wallet) {
            whereClause += ` AND u.wallet_address ILIKE $${paramIndex}`;
            params.push(`%${wallet}%`);
            paramIndex++;
        }

        if (date_from) {
            whereClause += ` AND b.processed_at >= $${paramIndex}`;
            params.push(new Date(date_from));
            paramIndex++;
        }

        if (date_to) {
            whereClause += ` AND b.processed_at <= $${paramIndex}`;
            params.push(new Date(date_to));
            paramIndex++;
        }

        // Contar total
        const countResult = await query(`
            SELECT COUNT(*)
            FROM bets b
            LEFT JOIN users u ON b.user_id = u.id
            ${whereClause}
        `, params);

        // Obtener premios
        const result = await query(`
            SELECT
                b.id as bet_id,
                u.wallet_address,
                d.draw_number,
                b.game_type,
                b.bet_number,
                b.amount as bet_amount,
                b.actual_payout as prize_amount,
                b.multiplier,
                b.processed_at as paid_at
            FROM bets b
            LEFT JOIN users u ON b.user_id = u.id
            LEFT JOIN draws d ON b.draw_id = d.id
            ${whereClause}
            ORDER BY b.processed_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...params, parseInt(limit), offset]);

        // Totales
        const totals = await query(`
            SELECT
                COUNT(*) as total_prizes,
                COALESCE(SUM(b.actual_payout), 0) as total_amount
            FROM bets b
            LEFT JOIN users u ON b.user_id = u.id
            ${whereClause}
        `, params);

        res.json({
            success: true,
            data: {
                prizes: result.rows,
                totals: {
                    count: parseInt(totals.rows[0].total_prizes),
                    amount: parseFloat(totals.rows[0].total_amount)
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].count),
                    totalPages: Math.ceil(countResult.rows[0].count / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Error listando premios:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener premios'
        });
    }
});

/**
 * GET /api/admin/transactions/export
 * Exportar transacciones a CSV
 */
router.get('/export', async (req, res) => {
    try {
        const { type = 'transactions', date_from, date_to } = req.query;

        const from = date_from ? new Date(date_from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const to = date_to ? new Date(date_to) : new Date();

        let data;
        let headers;

        if (type === 'bets') {
            const result = await query(`
                SELECT
                    b.id,
                    u.wallet_address,
                    d.draw_number,
                    b.game_type,
                    b.bet_number,
                    b.amount,
                    b.potential_payout,
                    b.status,
                    b.actual_payout,
                    b.created_at
                FROM bets b
                LEFT JOIN users u ON b.user_id = u.id
                LEFT JOIN draws d ON b.draw_id = d.id
                WHERE b.created_at >= $1 AND b.created_at <= $2
                AND b.is_corrido_child = false
                ORDER BY b.created_at DESC
            `, [from, to]);

            headers = ['ID', 'Wallet', 'Sorteo', 'Tipo', 'Numero', 'Apuesta', 'Potencial', 'Estado', 'Premio', 'Fecha'];
            data = result.rows.map(row => [
                row.id,
                row.wallet_address,
                row.draw_number,
                row.game_type,
                row.bet_number,
                row.amount,
                row.potential_payout,
                row.status,
                row.actual_payout,
                row.created_at
            ]);
        } else {
            const result = await query(`
                SELECT
                    t.id,
                    u.wallet_address,
                    t.transaction_type,
                    t.amount,
                    t.balance_before,
                    t.balance_after,
                    t.description,
                    t.created_at
                FROM transactions t
                LEFT JOIN users u ON t.user_id = u.id
                WHERE t.created_at >= $1 AND t.created_at <= $2
                ORDER BY t.created_at DESC
            `, [from, to]);

            headers = ['ID', 'Wallet', 'Tipo', 'Monto', 'Balance Antes', 'Balance Despues', 'Descripcion', 'Fecha'];
            data = result.rows.map(row => [
                row.id,
                row.wallet_address,
                row.transaction_type,
                row.amount,
                row.balance_before,
                row.balance_after,
                row.description,
                row.created_at
            ]);
        }

        res.json({
            success: true,
            data: {
                headers,
                rows: data,
                filename: `${type}_${from.toISOString().split('T')[0]}_${to.toISOString().split('T')[0]}.csv`
            }
        });
    } catch (error) {
        console.error('Error exportando:', error);
        res.status(500).json({
            success: false,
            message: 'Error al exportar datos'
        });
    }
});

module.exports = router;
