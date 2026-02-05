const { query } = require('../config/database');

// =================================
// MODELO DE CLAIM
// =================================

class Claim {
    /**
     * Crear nuevo claim
     */
    static async create({
        draw_id,
        user_address,
        ticket_id,
        category,
        prize_amount,
        merkle_proof,
        leaf_hash
    }) {
        const text = `
            INSERT INTO claims
            (draw_id, user_address, ticket_id, category, prize_amount, merkle_proof, leaf_hash)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;
        const values = [
            draw_id,
            user_address.toLowerCase(),
            ticket_id,
            category,
            prize_amount,
            JSON.stringify(merkle_proof),
            leaf_hash
        ];

        const result = await query(text, values);
        return result.rows[0];
    }

    /**
     * Buscar por ID
     */
    static async findById(id) {
        const text = 'SELECT * FROM claims WHERE id = $1';
        const result = await query(text, [id]);
        return result.rows[0] || null;
    }

    /**
     * Buscar claims de un usuario
     */
    static async findByUser(userAddress, { page = 1, limit = 20 } = {}) {
        const offset = (page - 1) * limit;
        const text = `
            SELECT c.*, d.draw_number, d.lottery_numbers, d.lottery_key
            FROM claims c
            JOIN draws d ON c.draw_id = d.id
            WHERE c.user_address = $1
            ORDER BY c.created_at DESC
            LIMIT $2 OFFSET $3
        `;
        const result = await query(text, [userAddress.toLowerCase(), limit, offset]);

        // Contar total
        const countResult = await query(
            'SELECT COUNT(*) FROM claims WHERE user_address = $1',
            [userAddress.toLowerCase()]
        );
        const total = parseInt(countResult.rows[0].count);

        return {
            claims: result.rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        };
    }

    /**
     * Buscar claims de un sorteo
     */
    static async findByDraw(drawId, { status = null } = {}) {
        let text = `
            SELECT c.*, lt.numbers as ticket_numbers, lt.key_number as ticket_key
            FROM claims c
            LEFT JOIN lottery_tickets lt ON c.ticket_id = lt.ticket_id
            WHERE c.draw_id = $1
        `;
        const values = [drawId];

        if (status) {
            text += ' AND c.status = $2';
            values.push(status);
        }

        text += ' ORDER BY c.created_at DESC';

        const result = await query(text, values);
        return result.rows;
    }

    /**
     * Buscar claim específico
     */
    static async findByDrawAndUser(drawId, userAddress, ticketId = null) {
        let text = `
            SELECT * FROM claims
            WHERE draw_id = $1 AND user_address = $2
        `;
        const values = [drawId, userAddress.toLowerCase()];

        if (ticketId) {
            text += ' AND ticket_id = $3';
            values.push(ticketId);
        }

        const result = await query(text, values);
        return ticketId ? result.rows[0] : result.rows;
    }

    /**
     * Marcar como reclamado
     */
    static async markClaimed(id, txHash) {
        const text = `
            UPDATE claims
            SET status = 'claimed',
                claimed_at = NOW(),
                claim_tx_hash = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(text, [txHash, id]);
        return result.rows[0];
    }

    /**
     * Marcar como fallido
     */
    static async markFailed(id, errorMessage) {
        const text = `
            UPDATE claims
            SET status = 'failed',
                error_message = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(text, [errorMessage, id]);
        return result.rows[0];
    }

    /**
     * Marcar como expirado
     */
    static async markExpired(id) {
        const text = `
            UPDATE claims
            SET status = 'expired'
            WHERE id = $1
            RETURNING *
        `;
        const result = await query(text, [id]);
        return result.rows[0];
    }

    /**
     * Obtener claims pendientes de un usuario
     */
    static async getPendingByUser(userAddress) {
        const text = `
            SELECT c.*, d.draw_number, d.claims_deadline,
                   mr.root_hash, mr.expires_at
            FROM claims c
            JOIN draws d ON c.draw_id = d.id
            LEFT JOIN merkle_roots mr ON c.draw_id = mr.draw_id
            WHERE c.user_address = $1
            AND c.status = 'pending'
            AND (d.claims_deadline IS NULL OR d.claims_deadline > NOW())
            ORDER BY c.prize_amount DESC
        `;
        const result = await query(text, [userAddress.toLowerCase()]);
        return result.rows;
    }

    /**
     * Obtener resumen de claims de usuario
     */
    static async getUserSummary(userAddress) {
        const text = `
            SELECT
                COUNT(*) as total_claims,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_claims,
                COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed_claims,
                SUM(CASE WHEN status = 'pending' THEN prize_amount ELSE 0 END) as pending_amount,
                SUM(CASE WHEN status = 'claimed' THEN prize_amount ELSE 0 END) as claimed_amount
            FROM claims
            WHERE user_address = $1
        `;
        const result = await query(text, [userAddress.toLowerCase()]);
        return result.rows[0];
    }

    /**
     * Expirar claims vencidos
     */
    static async expireOldClaims() {
        const text = `
            UPDATE claims c
            SET status = 'expired'
            FROM draws d
            WHERE c.draw_id = d.id
            AND c.status = 'pending'
            AND d.claims_deadline IS NOT NULL
            AND d.claims_deadline < NOW()
            RETURNING c.id
        `;
        const result = await query(text);
        return result.rowCount;
    }
}

module.exports = Claim;
