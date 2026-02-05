const { query } = require('../config/database');
const { AUDIT_ACTIONS } = require('../config/constants');

// =================================
// MODELO DE AUDIT LOG
// =================================

class AuditLog {
    /**
     * Crear un nuevo registro de auditoría
     * @param {Object} params
     * @param {string} params.action - Tipo de acción (de AUDIT_ACTIONS)
     * @param {string} params.entity_type - Tipo de entidad (draw, bet, user, system)
     * @param {number|string} params.entity_id - ID de la entidad afectada
     * @param {string} params.actor_address - Dirección wallet del actor (o 'system')
     * @param {Object} params.details - Detalles adicionales en JSON
     * @param {string} params.ip_address - IP del actor (opcional)
     */
    static async create({
        action,
        entity_type,
        entity_id = null,
        actor_address = 'system',
        details = {},
        ip_address = null
    }) {
        const text = `
            INSERT INTO audit_logs (action, entity_type, entity_id, actor_address, details, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const values = [
            action,
            entity_type,
            entity_id,
            actor_address.toLowerCase(),
            JSON.stringify(details),
            ip_address
        ];

        try {
            const result = await query(text, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating audit log:', error);
            // No lanzar error para no interrumpir operaciones principales
            return null;
        }
    }

    /**
     * Registrar acción de sorteo
     */
    static async logDrawAction(action, drawId, actorAddress, details = {}) {
        return await AuditLog.create({
            action,
            entity_type: 'draw',
            entity_id: drawId,
            actor_address: actorAddress,
            details
        });
    }

    /**
     * Registrar acción del sistema
     */
    static async logSystemAction(action, details = {}) {
        return await AuditLog.create({
            action,
            entity_type: 'system',
            actor_address: 'system',
            details
        });
    }

    /**
     * Registrar error
     */
    static async logError(action, error, details = {}) {
        return await AuditLog.create({
            action,
            entity_type: 'system',
            actor_address: 'system',
            details: {
                ...details,
                error: error.message,
                stack: error.stack
            }
        });
    }

    /**
     * Buscar logs por entidad
     */
    static async findByEntity(entityType, entityId, { page = 1, limit = 50 } = {}) {
        const offset = (page - 1) * limit;
        const text = `
            SELECT * FROM audit_logs
            WHERE entity_type = $1 AND entity_id = $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
        `;
        const result = await query(text, [entityType, entityId, limit, offset]);
        return result.rows;
    }

    /**
     * Buscar logs por acción
     */
    static async findByAction(action, { page = 1, limit = 50 } = {}) {
        const offset = (page - 1) * limit;
        const text = `
            SELECT * FROM audit_logs
            WHERE action = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `;
        const result = await query(text, [action, limit, offset]);
        return result.rows;
    }

    /**
     * Buscar logs por actor
     */
    static async findByActor(actorAddress, { page = 1, limit = 50 } = {}) {
        const offset = (page - 1) * limit;
        const text = `
            SELECT * FROM audit_logs
            WHERE actor_address = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `;
        const result = await query(text, [actorAddress.toLowerCase(), limit, offset]);
        return result.rows;
    }

    /**
     * Buscar logs recientes
     */
    static async findRecent({ page = 1, limit = 100, action = null, entityType = null } = {}) {
        const offset = (page - 1) * limit;
        let text = `SELECT * FROM audit_logs WHERE 1=1`;
        const values = [];
        let paramIndex = 1;

        if (action) {
            text += ` AND action = $${paramIndex}`;
            values.push(action);
            paramIndex++;
        }

        if (entityType) {
            text += ` AND entity_type = $${paramIndex}`;
            values.push(entityType);
            paramIndex++;
        }

        text += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        const result = await query(text, values);

        // Contar total
        let countText = 'SELECT COUNT(*) FROM audit_logs WHERE 1=1';
        const countValues = [];
        let countParamIndex = 1;

        if (action) {
            countText += ` AND action = $${countParamIndex}`;
            countValues.push(action);
            countParamIndex++;
        }

        if (entityType) {
            countText += ` AND entity_type = $${countParamIndex}`;
            countValues.push(entityType);
        }

        const countResult = await query(countText, countValues);
        const total = parseInt(countResult.rows[0].count);

        return {
            logs: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Limpiar logs antiguos (más de X días)
     */
    static async cleanOldLogs(daysToKeep = 90) {
        const text = `
            DELETE FROM audit_logs
            WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'
            RETURNING id
        `;
        const result = await query(text);
        return result.rowCount;
    }
}

module.exports = AuditLog;
