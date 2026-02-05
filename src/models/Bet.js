const { query, getClient } = require('../config/database');
const { BET_STATUS, GAME_RULES } = require('../config/constants');

// =================================
// MODELO DE APUESTA
// =================================

class Bet {
    /**
     * Crear una nueva apuesta
     */
    static async create({
        user_id,
        draw_id,
        game_type,
        bet_number,
        amount,
        potential_payout,
        multiplier,
        parent_bet_id = null,
        is_corrido_child = false
    }) {
        const text = `
            INSERT INTO bets (
                user_id, draw_id, game_type, bet_number, amount,
                potential_payout, multiplier, status,
                parent_bet_id, is_corrido_child
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `;
        const values = [
            user_id,
            draw_id,
            game_type,
            bet_number,
            amount,
            potential_payout,
            multiplier,
            BET_STATUS.PENDING,
            parent_bet_id,
            is_corrido_child
        ];

        const result = await query(text, values);
        return result.rows[0];
    }

    /**
     * Buscar apuesta por ID
     */
    static async findById(id) {
        const text = 'SELECT * FROM bets WHERE id = $1';
        const result = await query(text, [id]);
        return result.rows[0] || null;
    }

    /**
     * Obtener apuestas de un usuario
     */
    static async findByUserId(userId, { page = 1, limit = 20, status = null, drawId = null }) {
        let text = `
            SELECT
                b.*,
                d.draw_number,
                d.scheduled_time,
                d.status as draw_status,
                d.winning_number
            FROM bets b
            JOIN draws d ON b.draw_id = d.id
            WHERE b.user_id = $1
            AND b.is_corrido_child = false
        `;
        const values = [userId];
        let paramIndex = 2;

        // Filtrar por estado de apuesta
        if (status && Object.values(BET_STATUS).includes(status)) {
            text += ` AND b.status = $${paramIndex}`;
            values.push(status);
            paramIndex++;
        }

        // Filtrar por sorteo
        if (drawId) {
            text += ` AND b.draw_id = $${paramIndex}`;
            values.push(drawId);
            paramIndex++;
        }

        // Ordenar por fecha de creación descendente
        text += ` ORDER BY b.created_at DESC`;

        // Paginación
        const offset = (page - 1) * limit;
        text += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        const result = await query(text, values);

        // Contar total
        let countText = `
            SELECT COUNT(*)
            FROM bets b
            WHERE b.user_id = $1
            AND b.is_corrido_child = false
        `;
        const countValues = [userId];
        let countParamIndex = 2;

        if (status && Object.values(BET_STATUS).includes(status)) {
            countText += ` AND b.status = $${countParamIndex}`;
            countValues.push(status);
            countParamIndex++;
        }

        if (drawId) {
            countText += ` AND b.draw_id = $${countParamIndex}`;
            countValues.push(drawId);
        }

        const countResult = await query(countText, countValues);
        const total = parseInt(countResult.rows[0].count);

        return {
            bets: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Obtener apuestas de un sorteo
     */
    static async findByDrawId(drawId, { page = 1, limit = 50, status = null }) {
        let text = `
            SELECT
                b.*,
                u.username
            FROM bets b
            JOIN users u ON b.user_id = u.id
            WHERE b.draw_id = $1
            AND b.is_corrido_child = false
        `;
        const values = [drawId];
        let paramIndex = 2;

        // Filtrar por estado
        if (status && Object.values(BET_STATUS).includes(status)) {
            text += ` AND b.status = $${paramIndex}`;
            values.push(status);
            paramIndex++;
        }

        text += ` ORDER BY b.created_at DESC`;

        const offset = (page - 1) * limit;
        text += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        const result = await query(text, values);

        // Contar total
        let countText = 'SELECT COUNT(*) FROM bets WHERE draw_id = $1 AND is_corrido_child = false';
        const countValues = [drawId];

        if (status && Object.values(BET_STATUS).includes(status)) {
            countText += ' AND status = $2';
            countValues.push(status);
        }

        const countResult = await query(countText, countValues);
        const total = parseInt(countResult.rows[0].count);

        return {
            bets: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Obtener apuestas pendientes de un sorteo
     */
    static async getPendingBetsByDraw(drawId) {
        const text = `
            SELECT * FROM bets
            WHERE draw_id = $1 AND status = $2
            ORDER BY created_at ASC
        `;
        const result = await query(text, [drawId, BET_STATUS.PENDING]);
        return result.rows;
    }

    /**
     * Obtener apuestas hijas de una apuesta Corrido
     */
    static async getCorridoChildren(parentBetId) {
        const text = `
            SELECT * FROM bets
            WHERE parent_bet_id = $1 AND is_corrido_child = true
            ORDER BY created_at ASC
        `;
        const result = await query(text, [parentBetId]);
        return result.rows;
    }

    /**
     * Actualizar estado de apuesta
     */
    static async updateStatus(id, status, actualPayout = 0) {
        const text = `
            UPDATE bets
            SET status = $1,
                actual_payout = $2,
                processed_at = NOW()
            WHERE id = $3
            RETURNING *
        `;
        const result = await query(text, [status, actualPayout, id]);
        return result.rows[0];
    }

    /**
     * Obtener estadísticas de apuestas de un usuario
     */
    static async getUserBetStats(userId) {
        const text = `
            SELECT
                COUNT(*) as total_bets,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bets,
                COUNT(CASE WHEN status = 'won' THEN 1 END) as won_bets,
                COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_bets,
                COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
                COALESCE(SUM(CASE WHEN status IN ('won', 'lost') THEN amount ELSE 0 END), 0) as total_wagered,
                COALESCE(SUM(CASE WHEN status = 'won' THEN actual_payout ELSE 0 END), 0) as total_winnings
            FROM bets
            WHERE user_id = $1 AND is_corrido_child = false
        `;
        const result = await query(text, [userId]);
        return result.rows[0];
    }

    /**
     * Obtener estadísticas de un sorteo
     */
    static async getDrawBetStats(drawId) {
        const text = `
            SELECT
                COUNT(*) as total_bets,
                COUNT(DISTINCT user_id) as unique_bettors,
                COALESCE(SUM(amount), 0) as total_amount,
                COUNT(CASE WHEN status = 'won' THEN 1 END) as winners_count,
                COALESCE(SUM(CASE WHEN status = 'won' THEN actual_payout ELSE 0 END), 0) as total_payouts
            FROM bets
            WHERE draw_id = $1 AND is_corrido_child = false
        `;
        const result = await query(text, [drawId]);
        return result.rows[0];
    }

    /**
     * Listar todas las apuestas (para admin)
     */
    static async findAll({ page = 1, limit = 50, userId = null, drawId = null, status = null }) {
        let text = `
            SELECT
                b.*,
                u.username,
                d.draw_number
            FROM bets b
            JOIN users u ON b.user_id = u.id
            JOIN draws d ON b.draw_id = d.id
            WHERE b.is_corrido_child = false
        `;
        const values = [];
        let paramIndex = 1;

        // Filtros
        if (userId) {
            text += ` AND b.user_id = $${paramIndex}`;
            values.push(userId);
            paramIndex++;
        }

        if (drawId) {
            text += ` AND b.draw_id = $${paramIndex}`;
            values.push(drawId);
            paramIndex++;
        }

        if (status && Object.values(BET_STATUS).includes(status)) {
            text += ` AND b.status = $${paramIndex}`;
            values.push(status);
            paramIndex++;
        }

        text += ` ORDER BY b.created_at DESC`;

        const offset = (page - 1) * limit;
        text += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        const result = await query(text, values);

        // Contar total
        let countText = 'SELECT COUNT(*) FROM bets WHERE is_corrido_child = false';
        const countValues = [];
        let countParamIndex = 1;

        if (userId) {
            countText += ` AND user_id = $${countParamIndex}`;
            countValues.push(userId);
            countParamIndex++;
        }

        if (drawId) {
            countText += ` AND draw_id = $${countParamIndex}`;
            countValues.push(drawId);
            countParamIndex++;
        }

        if (status && Object.values(BET_STATUS).includes(status)) {
            countText += ` AND status = $${countParamIndex}`;
            countValues.push(status);
        }

        const countResult = await query(countText, countValues);
        const total = parseInt(countResult.rows[0].count);

        return {
            bets: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Cancelar apuesta
     */
    static async cancel(id) {
        const text = `
            UPDATE bets
            SET status = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(text, [BET_STATUS.CANCELLED, id]);
        return result.rows[0];
    }
}

module.exports = Bet;
