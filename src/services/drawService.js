const Draw = require('../models/Draw');
const { DRAW_STATUS, ERROR_MESSAGES } = require('../config/constants');

// =================================
// SERVICIO DE SORTEOS
// =================================

/**
 * Crear un nuevo sorteo
 */
async function createDraw({ draw_number, scheduled_time }) {
    // Validar que la hora programada sea futura
    const scheduledDate = new Date(scheduled_time);
    const now = new Date();

    if (scheduledDate <= now) {
        throw new Error('La hora programada debe ser en el futuro');
    }

    // Verificar que no exista un sorteo con el mismo número
    const existing = await Draw.findByDrawNumber(draw_number);
    if (existing) {
        throw new Error('Ya existe un sorteo con ese número');
    }

    // Crear el sorteo
    const draw = await Draw.create({
        draw_number,
        scheduled_time,
        status: DRAW_STATUS.SCHEDULED
    });

    return draw;
}

/**
 * Obtener sorteos activos
 */
async function getActiveDraws() {
    return await Draw.getActive();
}

/**
 * Obtener próximos sorteos
 */
async function getUpcomingDraws(limit = 5) {
    return await Draw.getUpcoming(limit);
}

/**
 * Obtener sorteos completados
 */
async function getCompletedDraws({ page = 1, limit = 20 }) {
    return await Draw.getCompleted({ page, limit });
}

/**
 * Obtener sorteo por ID
 */
async function getDrawById(id) {
    const draw = await Draw.findById(id);

    if (!draw) {
        throw new Error(ERROR_MESSAGES.DRAW_NOT_FOUND);
    }

    return draw;
}

/**
 * Obtener sorteo con sus estadísticas
 */
async function getDrawWithStats(id) {
    const stats = await Draw.getStats(id);

    if (!stats) {
        throw new Error(ERROR_MESSAGES.DRAW_NOT_FOUND);
    }

    return stats;
}

/**
 * Abrir sorteo para apuestas
 */
async function openDraw(id) {
    const draw = await Draw.findById(id);

    if (!draw) {
        throw new Error(ERROR_MESSAGES.DRAW_NOT_FOUND);
    }

    // Verificar que el sorteo esté en estado 'scheduled'
    if (draw.status !== DRAW_STATUS.SCHEDULED) {
        throw new Error('Solo se pueden abrir sorteos en estado "programado"');
    }

    // Verificar que la hora programada sea futura
    const scheduledDate = new Date(draw.scheduled_time);
    const now = new Date();

    if (scheduledDate <= now) {
        throw new Error('No se puede abrir un sorteo cuya hora ya pasó');
    }

    return await Draw.open(id);
}

/**
 * Cerrar sorteo para apuestas
 */
async function closeDraw(id) {
    const draw = await Draw.findById(id);

    if (!draw) {
        throw new Error(ERROR_MESSAGES.DRAW_NOT_FOUND);
    }

    // Verificar que el sorteo esté abierto
    if (draw.status !== DRAW_STATUS.OPEN && draw.status !== DRAW_STATUS.SCHEDULED) {
        throw new Error('Solo se pueden cerrar sorteos abiertos o programados');
    }

    return await Draw.close(id);
}

/**
 * Actualizar sorteo
 */
async function updateDraw(id, updates) {
    const draw = await Draw.findById(id);

    if (!draw) {
        throw new Error(ERROR_MESSAGES.DRAW_NOT_FOUND);
    }

    // No permitir actualizar sorteos completados
    if (draw.status === DRAW_STATUS.COMPLETED) {
        throw new Error('No se pueden actualizar sorteos completados');
    }

    // Si se actualiza la hora programada, verificar que sea futura
    if (updates.scheduled_time) {
        const scheduledDate = new Date(updates.scheduled_time);
        const now = new Date();

        if (scheduledDate <= now) {
            throw new Error('La hora programada debe ser en el futuro');
        }
    }

    return await Draw.update(id, updates);
}

/**
 * Refund all bets for a draw
 * Credits bet amounts back to user balances within a transaction
 */
async function refundDrawBets(drawId) {
    const { getClient } = require('../config/database');
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Get all pending bets for this draw
        const betsResult = await client.query(
            `SELECT id, user_id, amount, game_type FROM bets
             WHERE draw_id = $1 AND status = 'pending'
             FOR UPDATE`,
            [drawId]
        );

        if (betsResult.rows.length === 0) {
            await client.query('COMMIT');
            return { refunded: 0, totalAmount: 0 };
        }

        let totalRefunded = 0;

        for (const bet of betsResult.rows) {
            const refundAmount = Math.round(parseFloat(bet.amount) * 100) / 100;

            // Credit user balance with optimistic locking
            await client.query(
                `UPDATE users SET balance = balance + $1, version = version + 1
                 WHERE id = $2`,
                [refundAmount, bet.user_id]
            );

            // Mark bet as refunded
            await client.query(
                `UPDATE bets SET status = 'refunded', updated_at = NOW()
                 WHERE id = $1`,
                [bet.id]
            );

            totalRefunded += refundAmount;
        }

        // Clear number exposure for this draw
        await client.query(
            'DELETE FROM number_exposure WHERE draw_id = $1',
            [drawId]
        );

        await client.query('COMMIT');

        console.log(`[DrawService] Refunded ${betsResult.rows.length} bets for draw ${drawId}, total: ${totalRefunded} USDT`);

        return {
            refunded: betsResult.rows.length,
            totalAmount: Math.round(totalRefunded * 100) / 100
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[DrawService] Error refunding draw ${drawId}:`, error.message);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Cancelar sorteo
 */
async function cancelDraw(id) {
    const draw = await Draw.findById(id);

    if (!draw) {
        throw new Error(ERROR_MESSAGES.DRAW_NOT_FOUND);
    }

    // No permitir cancelar sorteos completados
    if (draw.status === DRAW_STATUS.COMPLETED) {
        throw new Error('No se pueden cancelar sorteos completados');
    }

    // Verificar si hay apuestas
    const { query } = require('../config/database');
    const betsResult = await query(
        'SELECT COUNT(*) FROM bets WHERE draw_id = $1',
        [id]
    );
    const betsCount = parseInt(betsResult.rows[0].count);

    if (betsCount > 0) {
        await refundDrawBets(id);
    }

    return await Draw.cancel(id);
}

/**
 * Eliminar sorteo
 */
async function deleteDraw(id) {
    const draw = await Draw.findById(id);

    if (!draw) {
        throw new Error(ERROR_MESSAGES.DRAW_NOT_FOUND);
    }

    // Solo permitir eliminar sorteos programados sin apuestas
    if (draw.status !== DRAW_STATUS.SCHEDULED && draw.status !== DRAW_STATUS.CANCELLED) {
        throw new Error('Solo se pueden eliminar sorteos programados o cancelados');
    }

    // Verificar que no tenga apuestas
    const { query } = require('../config/database');
    const betsResult = await query(
        'SELECT COUNT(*) FROM bets WHERE draw_id = $1',
        [id]
    );
    const betsCount = parseInt(betsResult.rows[0].count);

    if (betsCount > 0) {
        throw new Error('No se puede eliminar un sorteo con apuestas');
    }

    return await Draw.delete(id);
}

/**
 * Listar todos los sorteos (para admin)
 */
async function listDraws({ page = 1, limit = 50, status = null }) {
    return await Draw.findAll({ page, limit, status });
}

/**
 * Verificar si un sorteo está abierto para apuestas
 */
async function isDrawOpenForBets(drawId) {
    return await Draw.isOpenForBets(drawId);
}

/**
 * Generar número de sorteo automáticamente
 * Formato: YYYY-MM-DD-HH (ej: 2026-01-13-14 para las 2 PM)
 */
function generateDrawNumber(scheduledTime) {
    const date = new Date(scheduledTime);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');

    return `${year}-${month}-${day}-${hour}`;
}

/**
 * Crear múltiples sorteos para un día
 */
async function createDailyDraws(date, times) {
    // date: fecha en formato YYYY-MM-DD
    // times: array de horas en formato HH:MM (ej: ['09:00', '12:00', '15:00', '18:00'])

    const draws = [];

    for (const time of times) {
        const [hour, minute] = time.split(':');
        const scheduledTime = new Date(`${date}T${hour}:${minute}:00`);
        const drawNumber = generateDrawNumber(scheduledTime);

        try {
            const draw = await createDraw({
                draw_number: drawNumber,
                scheduled_time: scheduledTime
            });
            draws.push(draw);
        } catch (error) {
            console.error(`Error creando sorteo ${drawNumber}:`, error.message);
            // Continuar con los siguientes sorteos
        }
    }

    return draws;
}

module.exports = {
    createDraw,
    getActiveDraws,
    getUpcomingDraws,
    getCompletedDraws,
    getDrawById,
    getDrawWithStats,
    openDraw,
    closeDraw,
    updateDraw,
    cancelDraw,
    refundDrawBets,
    deleteDraw,
    listDraws,
    isDrawOpenForBets,
    generateDrawNumber,
    createDailyDraws
};
