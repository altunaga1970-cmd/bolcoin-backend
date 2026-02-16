const { query, getClient } = require('../config/database');
const { DRAW_STATUS, DRAW_STATE_MACHINE } = require('../config/constants');

// =================================
// MODELO DE SORTEO
// =================================

class Draw {
    /**
     * Crear un nuevo sorteo
     */
    static async create({ draw_number, scheduled_time, status = DRAW_STATUS.SCHEDULED }) {
        const text = `
            INSERT INTO draws (draw_number, scheduled_time, status)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const values = [draw_number, scheduled_time, status];

        try {
            const result = await query(text, values);
            return result.rows[0];
        } catch (error) {
            // Manejar error de número de sorteo duplicado
            if (error.code === '23505' && error.constraint === 'draws_draw_number_key') {
                throw new Error('El número de sorteo ya existe');
            }
            throw error;
        }
    }

    /**
     * Buscar sorteo por ID
     */
    static async findById(id) {
        const text = 'SELECT * FROM draws WHERE id = $1';
        const result = await query(text, [id]);
        return result.rows[0] || null;
    }

    /**
     * Buscar sorteo por número de sorteo
     */
    static async findByDrawNumber(drawNumber) {
        const text = 'SELECT * FROM draws WHERE draw_number = $1';
        const result = await query(text, [drawNumber]);
        return result.rows[0] || null;
    }

    /**
     * Obtener sorteos activos (abiertos para apuestas)
     * Returns draws with 'open' or 'scheduled' status.
     * scheduled_time represents when results are drawn, not when betting starts.
     */
    static async getActive() {
        const text = `
            SELECT * FROM draws
            WHERE status IN ($1, $2)
            ORDER BY scheduled_time ASC
        `;
        const result = await query(text, [DRAW_STATUS.SCHEDULED, DRAW_STATUS.OPEN]);
        return result.rows;
    }

    /**
     * Obtener próximos sorteos
     */
    static async getUpcoming(limit = 5) {
        const text = `
            SELECT * FROM draws
            WHERE status = $1
            AND scheduled_time > NOW()
            ORDER BY scheduled_time ASC
            LIMIT $2
        `;
        const result = await query(text, [DRAW_STATUS.SCHEDULED, limit]);
        return result.rows;
    }

    /**
     * Obtener sorteos completados (con resultados)
     */
    static async getCompleted({ page = 1, limit = 20 }) {
        const offset = (page - 1) * limit;

        const text = `
            SELECT * FROM draws
            WHERE status = $1
            ORDER BY scheduled_time DESC
            LIMIT $2 OFFSET $3
        `;
        const result = await query(text, [DRAW_STATUS.COMPLETED, limit, offset]);

        // Contar total
        const countResult = await query(
            'SELECT COUNT(*) FROM draws WHERE status = $1',
            [DRAW_STATUS.COMPLETED]
        );
        const total = parseInt(countResult.rows[0].count);

        return {
            draws: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Actualizar estado del sorteo
     */
    static async updateStatus(id, status) {
        const text = `
            UPDATE draws
            SET status = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(text, [status, id]);
        return result.rows[0];
    }

    /**
     * Ingresar número ganador
     */
    static async enterWinningNumber(id, winningNumber, enteredBy) {
        const text = `
            UPDATE draws
            SET winning_number = $1,
                result_entered_at = NOW(),
                result_entered_by = $2,
                status = $3
            WHERE id = $4
            RETURNING *
        `;
        const result = await query(text, [
            winningNumber,
            enteredBy,
            DRAW_STATUS.COMPLETED,
            id
        ]);
        return result.rows[0];
    }

    /**
     * Actualizar estadísticas del sorteo después de procesar pagos
     */
    static async updateStats(id, { total_bets_amount, total_payouts_amount, bets_count, winners_count }) {
        const text = `
            UPDATE draws
            SET total_bets_amount = $1,
                total_payouts_amount = $2,
                bets_count = $3,
                winners_count = $4
            WHERE id = $5
            RETURNING *
        `;
        const result = await query(text, [
            total_bets_amount,
            total_payouts_amount,
            bets_count,
            winners_count,
            id
        ]);
        return result.rows[0];
    }

    /**
     * Actualizar sorteo
     */
    static async update(id, updates) {
        const allowedFields = ['draw_number', 'scheduled_time', 'status'];
        const fields = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }
        }

        if (fields.length === 0) {
            throw new Error('No hay campos para actualizar');
        }

        values.push(id);
        const text = `
            UPDATE draws
            SET ${fields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const result = await query(text, values);
        return result.rows[0];
    }

    /**
     * Eliminar sorteo
     */
    static async delete(id) {
        const text = 'DELETE FROM draws WHERE id = $1 RETURNING *';
        const result = await query(text, [id]);
        return result.rows[0];
    }

    /**
     * Listar todos los sorteos (para admin)
     */
    static async findAll({ page = 1, limit = 50, status = null }) {
        let text = `
            SELECT
                d.*,
                u.username as entered_by_username
            FROM draws d
            LEFT JOIN users u ON d.result_entered_by = u.id
            WHERE 1=1
        `;
        const values = [];
        let paramIndex = 1;

        // Filtrar por estado
        if (status) {
            text += ` AND d.status = $${paramIndex}`;
            values.push(status);
            paramIndex++;
        }

        // Ordenar por fecha programada descendente
        text += ` ORDER BY d.scheduled_time DESC`;

        // Paginación
        const offset = (page - 1) * limit;
        text += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        const result = await query(text, values);

        // Contar total
        let countText = 'SELECT COUNT(*) FROM draws WHERE 1=1';
        const countValues = [];

        if (status) {
            countText += ' AND status = $1';
            countValues.push(status);
        }

        const countResult = await query(countText, countValues);
        const total = parseInt(countResult.rows[0].count);

        return {
            draws: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Verificar si un sorteo está abierto para apuestas
     */
    static async isOpenForBets(id) {
        const text = `
            SELECT id, status, scheduled_time
            FROM draws
            WHERE id = $1
        `;
        const result = await query(text, [id]);

        if (result.rows.length === 0) {
            return false;
        }

        const draw = result.rows[0];
        const now = new Date();
        const scheduledTime = new Date(draw.scheduled_time);

        // Debe estar en estado 'open' o 'scheduled' y la hora programada debe ser futura
        return (draw.status === DRAW_STATUS.OPEN || draw.status === DRAW_STATUS.SCHEDULED) &&
               scheduledTime > now;
    }

    /**
     * Obtener sorteo con sus apuestas
     */
    static async getWithBets(id) {
        const draw = await Draw.findById(id);

        if (!draw) {
            return null;
        }

        // Obtener apuestas del sorteo
        const betsResult = await query(
            'SELECT * FROM bets WHERE draw_id = $1 ORDER BY created_at DESC',
            [id]
        );

        return {
            ...draw,
            bets: betsResult.rows
        };
    }

    /**
     * Obtener estadísticas del sorteo
     */
    static async getStats(id) {
        const text = `
            SELECT
                d.id,
                d.draw_number,
                d.status,
                d.winning_number,
                d.total_bets_amount,
                d.total_payouts_amount,
                d.bets_count,
                d.winners_count,
                COUNT(DISTINCT b.user_id) as unique_bettors,
                COUNT(b.id) as actual_bets_count,
                SUM(CASE WHEN b.status = 'won' THEN 1 ELSE 0 END) as actual_winners_count,
                SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) as pending_bets_count
            FROM draws d
            LEFT JOIN bets b ON d.id = b.draw_id
            WHERE d.id = $1
            GROUP BY d.id
        `;
        const result = await query(text, [id]);
        return result.rows[0];
    }

    /**
     * Abrir sorteo para apuestas (cambiar a estado OPEN)
     */
    static async open(id) {
        return await Draw.updateStatus(id, DRAW_STATUS.OPEN);
    }

    /**
     * Cerrar sorteo para apuestas (cambiar a estado CLOSED)
     */
    static async close(id) {
        return await Draw.updateStatus(id, DRAW_STATUS.CLOSED);
    }

    /**
     * Cancelar sorteo
     */
    static async cancel(id) {
        return await Draw.updateStatus(id, DRAW_STATUS.CANCELLED);
    }

    // =================================
    // MÉTODOS VRF Y ESTADOS EXTENDIDOS
    // =================================

    /**
     * Registrar solicitud VRF
     */
    static async setVrfRequested(id, requestId) {
        const text = `
            UPDATE draws
            SET status = 'vrf_requested',
                vrf_request_id = $1,
                vrf_requested_at = NOW()
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(text, [requestId, id]);
        return result.rows[0];
    }

    /**
     * Registrar respuesta VRF
     */
    static async setVrfFulfilled(id, randomWord, winningNumber = null) {
        const text = `
            UPDATE draws
            SET status = 'vrf_fulfilled',
                vrf_random_word = $1,
                vrf_fulfilled_at = NOW(),
                winning_number = COALESCE($2, winning_number)
            WHERE id = $3
            RETURNING *
        `;
        const result = await query(text, [randomWord, winningNumber, id]);
        return result.rows[0];
    }

    /**
     * Marcar sorteo como liquidado (winners calculados)
     */
    static async setSettled(id, stats = {}) {
        const text = `
            UPDATE draws
            SET status = 'settled',
                total_bets_amount = COALESCE($1, total_bets_amount),
                total_payouts_amount = COALESCE($2, total_payouts_amount),
                bets_count = COALESCE($3, bets_count),
                winners_count = COALESCE($4, winners_count)
            WHERE id = $5
            RETURNING *
        `;
        const result = await query(text, [
            stats.total_bets_amount,
            stats.total_payouts_amount,
            stats.bets_count,
            stats.winners_count,
            id
        ]);
        return result.rows[0];
    }

    /**
     * Publicar Merkle root (para La Fortuna)
     */
    static async publishMerkleRoot(id, merkleRoot, claimsDeadline) {
        const text = `
            UPDATE draws
            SET status = 'roots_published',
                merkle_root = $1,
                claims_deadline = $2
            WHERE id = $3
            RETURNING *
        `;
        const result = await query(text, [merkleRoot, claimsDeadline, id]);
        return result.rows[0];
    }

    /**
     * Abrir período de claims
     */
    static async openClaims(id) {
        const text = `
            UPDATE draws
            SET status = 'claims_open'
            WHERE id = $1
            RETURNING *
        `;
        const result = await query(text, [id]);
        return result.rows[0];
    }

    /**
     * Completar sorteo
     */
    static async complete(id) {
        const text = `
            UPDATE draws
            SET status = 'completed',
                result_entered_at = COALESCE(result_entered_at, NOW())
            WHERE id = $1
            RETURNING *
        `;
        const result = await query(text, [id]);
        return result.rows[0];
    }

    /**
     * Verificar si una transición de estado es válida
     */
    static isValidTransition(currentStatus, newStatus) {
        const allowedTransitions = DRAW_STATE_MACHINE.transitions[currentStatus];
        return allowedTransitions && allowedTransitions.includes(newStatus);
    }

    /**
     * Obtener sorteos pendientes de VRF
     */
    static async getPendingVrf() {
        const text = `
            SELECT * FROM draws
            WHERE status = 'closed'
            AND scheduled_time < NOW()
            ORDER BY scheduled_time ASC
        `;
        const result = await query(text);
        return result.rows;
    }

    /**
     * Obtener sorteos esperando respuesta VRF
     */
    static async getAwaitingVrf() {
        const text = `
            SELECT * FROM draws
            WHERE status = 'vrf_requested'
            ORDER BY vrf_requested_at ASC
        `;
        const result = await query(text);
        return result.rows;
    }

    /**
     * Obtener sorteos pendientes de liquidación
     */
    static async getPendingSettlement() {
        const text = `
            SELECT * FROM draws
            WHERE status = 'vrf_fulfilled'
            ORDER BY vrf_fulfilled_at ASC
        `;
        const result = await query(text);
        return result.rows;
    }

    /**
     * Obtener sorteos que necesitan cerrarse
     */
    static async getNeedingClose(minutesBefore = 5) {
        const text = `
            SELECT * FROM draws
            WHERE status = 'open'
            AND scheduled_time <= NOW() + $1 * INTERVAL '1 minute'
            ORDER BY scheduled_time ASC
        `;
        const result = await query(text, [minutesBefore]);
        return result.rows;
    }

    /**
     * Obtener sorteos que necesitan abrirse
     */
    static async getNeedingOpen() {
        const text = `
            SELECT * FROM draws
            WHERE status = 'scheduled'
            AND scheduled_time <= NOW()
            ORDER BY scheduled_time ASC
        `;
        const result = await query(text);
        return result.rows;
    }

    /**
     * Crear sorteo de La Fortuna (lottery)
     */
    static async createLottery({ draw_number, scheduled_time, status = DRAW_STATUS.SCHEDULED }) {
        const text = `
            INSERT INTO draws (draw_number, scheduled_time, status, draw_type)
            VALUES ($1, $2, $3, 'lottery')
            RETURNING *
        `;
        const values = [draw_number, scheduled_time, status];

        try {
            const result = await query(text, values);
            return result.rows[0];
        } catch (error) {
            if (error.code === '23505' && error.constraint === 'draws_draw_number_key') {
                throw new Error('El número de sorteo ya existe');
            }
            throw error;
        }
    }

    /**
     * Establecer números ganadores de La Fortuna
     */
    static async setLotteryResults(id, numbers, keyNumber) {
        // Validate inputs
        if (!Array.isArray(numbers) || numbers.length !== 6) {
            throw new Error('Se requieren exactamente 6 numeros');
        }
        const uniqueNums = new Set(numbers);
        if (uniqueNums.size !== 6) {
            throw new Error('Los numeros deben ser unicos');
        }
        for (const n of numbers) {
            if (!Number.isInteger(n) || n < 1 || n > 49) {
                throw new Error('Numeros deben ser enteros del 1 al 49');
            }
        }
        if (!Number.isInteger(keyNumber) || keyNumber < 0 || keyNumber > 9) {
            throw new Error('Numero clave debe ser entero del 0 al 9');
        }

        const text = `
            UPDATE draws
            SET lottery_numbers = $1,
                lottery_key = $2
            WHERE id = $3
            RETURNING *
        `;
        const result = await query(text, [JSON.stringify(numbers), keyNumber, id]);
        return result.rows[0];
    }
}

module.exports = Draw;
