const { query } = require('../config/database');

// =================================
// MODELO DE MERKLE ROOT
// =================================

class MerkleRoot {
    /**
     * Crear nuevo Merkle root
     */
    static async create({
        draw_id,
        root_hash,
        tree_data,
        total_winners = 0,
        total_prize_amount = 0,
        published_by,
        tx_hash = null,
        expires_at = null
    }) {
        const text = `
            INSERT INTO merkle_roots
            (draw_id, root_hash, tree_data, total_winners, total_prize_amount,
             published_by, tx_hash, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;
        const values = [
            draw_id,
            root_hash,
            JSON.stringify(tree_data),
            total_winners,
            total_prize_amount,
            published_by?.toLowerCase(),
            tx_hash,
            expires_at
        ];

        const result = await query(text, values);
        return result.rows[0];
    }

    /**
     * Buscar por ID
     */
    static async findById(id) {
        const text = 'SELECT * FROM merkle_roots WHERE id = $1';
        const result = await query(text, [id]);
        return result.rows[0] || null;
    }

    /**
     * Buscar por draw_id
     */
    static async findByDrawId(drawId) {
        const text = 'SELECT * FROM merkle_roots WHERE draw_id = $1';
        const result = await query(text, [drawId]);
        return result.rows[0] || null;
    }

    /**
     * Obtener roots activos
     */
    static async getActive() {
        const text = `
            SELECT mr.*, d.draw_number, d.lottery_numbers, d.lottery_key
            FROM merkle_roots mr
            JOIN draws d ON mr.draw_id = d.id
            WHERE mr.status = 'active'
            AND (mr.expires_at IS NULL OR mr.expires_at > NOW())
            ORDER BY mr.published_at DESC
        `;
        const result = await query(text);
        return result.rows;
    }

    /**
     * Actualizar estado
     */
    static async updateStatus(id, status) {
        const text = `
            UPDATE merkle_roots
            SET status = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(text, [status, id]);
        return result.rows[0];
    }

    /**
     * Marcar como expirado
     */
    static async expire(id) {
        return await MerkleRoot.updateStatus(id, 'expired');
    }

    /**
     * Actualizar tx hash
     */
    static async setTxHash(id, txHash) {
        const text = `
            UPDATE merkle_roots
            SET tx_hash = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(text, [txHash, id]);
        return result.rows[0];
    }

    /**
     * Obtener estadísticas
     */
    static async getStats(drawId) {
        const text = `
            SELECT
                mr.*,
                COUNT(c.id) as claims_count,
                COUNT(CASE WHEN c.status = 'claimed' THEN 1 END) as claimed_count,
                SUM(CASE WHEN c.status = 'claimed' THEN c.prize_amount ELSE 0 END) as claimed_amount
            FROM merkle_roots mr
            LEFT JOIN claims c ON mr.draw_id = c.draw_id
            WHERE mr.draw_id = $1
            GROUP BY mr.id
        `;
        const result = await query(text, [drawId]);
        return result.rows[0];
    }
}

module.exports = MerkleRoot;
