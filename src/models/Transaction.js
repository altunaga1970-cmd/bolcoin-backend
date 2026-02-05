const { query } = require('../config/database');
const { TRANSACTION_TYPE } = require('../config/constants');

// =================================
// MODELO DE TRANSACCIÓN
// =================================

class Transaction {
    /**
     * Crear una nueva transacción
     */
    static async create({
        user_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reference_type = null,
        reference_id = null,
        description = ''
    }) {
        const text = `
            INSERT INTO transactions (
                user_id, transaction_type, amount, balance_before, balance_after,
                reference_type, reference_id, description
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;
        const values = [
            user_id,
            transaction_type,
            amount,
            balance_before,
            balance_after,
            reference_type,
            reference_id,
            description
        ];

        const result = await query(text, values);
        return result.rows[0];
    }

    /**
     * Buscar transacción por ID
     */
    static async findById(id) {
        const text = 'SELECT * FROM transactions WHERE id = $1';
        const result = await query(text, [id]);
        return result.rows[0] || null;
    }

    /**
     * Obtener transacciones de un usuario
     */
    static async findByUserId(userId, { page = 1, limit = 20, type = null }) {
        let text = `
            SELECT *
            FROM transactions
            WHERE user_id = $1
        `;
        const values = [userId];
        let paramIndex = 2;

        // Filtrar por tipo de transacción
        if (type && Object.values(TRANSACTION_TYPE).includes(type)) {
            text += ` AND transaction_type = $${paramIndex}`;
            values.push(type);
            paramIndex++;
        }

        // Ordenar por fecha descendente
        text += ` ORDER BY created_at DESC`;

        // Paginación
        const offset = (page - 1) * limit;
        text += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        const result = await query(text, values);

        // Contar total de transacciones
        let countText = 'SELECT COUNT(*) FROM transactions WHERE user_id = $1';
        const countValues = [userId];

        if (type && Object.values(TRANSACTION_TYPE).includes(type)) {
            countText += ' AND transaction_type = $2';
            countValues.push(type);
        }

        const countResult = await query(countText, countValues);
        const total = parseInt(countResult.rows[0].count);

        return {
            transactions: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Obtener transacciones por referencia
     */
    static async findByReference(referenceType, referenceId) {
        const text = `
            SELECT *
            FROM transactions
            WHERE reference_type = $1 AND reference_id = $2
            ORDER BY created_at DESC
        `;
        const result = await query(text, [referenceType, referenceId]);
        return result.rows;
    }

    /**
     * Obtener estadísticas de transacciones de un usuario
     */
    static async getUserTransactionStats(userId) {
        const text = `
            SELECT
                transaction_type,
                COUNT(*) as count,
                SUM(amount) as total_amount
            FROM transactions
            WHERE user_id = $1
            GROUP BY transaction_type
        `;
        const result = await query(text, [userId]);
        return result.rows;
    }

    /**
     * Obtener todas las transacciones (para admin)
     */
    static async findAll({ page = 1, limit = 50, type = null, userId = null }) {
        let text = `
            SELECT
                t.*,
                u.username
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE 1=1
        `;
        const values = [];
        let paramIndex = 1;

        // Filtrar por tipo
        if (type && Object.values(TRANSACTION_TYPE).includes(type)) {
            text += ` AND t.transaction_type = $${paramIndex}`;
            values.push(type);
            paramIndex++;
        }

        // Filtrar por usuario
        if (userId) {
            text += ` AND t.user_id = $${paramIndex}`;
            values.push(userId);
            paramIndex++;
        }

        // Ordenar y paginar
        text += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        const offset = (page - 1) * limit;
        values.push(limit, offset);

        const result = await query(text, values);

        // Contar total
        let countText = 'SELECT COUNT(*) FROM transactions WHERE 1=1';
        const countValues = [];
        let countParamIndex = 1;

        if (type && Object.values(TRANSACTION_TYPE).includes(type)) {
            countText += ` AND transaction_type = $${countParamIndex}`;
            countValues.push(type);
            countParamIndex++;
        }

        if (userId) {
            countText += ` AND user_id = $${countParamIndex}`;
            countValues.push(userId);
        }

        const countResult = await query(countText, countValues);
        const total = parseInt(countResult.rows[0].count);

        return {
            transactions: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Obtener resumen financiero del sistema (para admin)
     */
    static async getSystemFinancialSummary() {
        const text = `
            SELECT
                SUM(CASE WHEN transaction_type = 'recharge' THEN amount ELSE 0 END) as total_recharges,
                SUM(CASE WHEN transaction_type = 'bet' THEN ABS(amount) ELSE 0 END) as total_bets,
                SUM(CASE WHEN transaction_type = 'win' THEN amount ELSE 0 END) as total_wins,
                SUM(CASE WHEN transaction_type = 'refund' THEN amount ELSE 0 END) as total_refunds,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(*) as total_transactions
            FROM transactions
        `;
        const result = await query(text);
        return result.rows[0];
    }
}

module.exports = Transaction;
