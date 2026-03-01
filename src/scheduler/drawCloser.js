const Draw = require('../models/Draw');
const AuditLog = require('../models/AuditLog');
const { SCHEDULER_CONFIG, AUDIT_ACTIONS } = require('../config/constants');

// =================================
// DRAW CLOSER
// Cierra sorteos antes de la hora programada
// =================================

class DrawCloser {
    /**
     * Cerrar sorteos que están por empezar
     */
    async closeDrawsBeforeTime() {
        try {
            const minutesBefore = SCHEDULER_CONFIG.CLOSE_BEFORE_DRAW_MINUTES;
            let draws = await Draw.getNeedingClose(minutesBefore);

            // On-chain mode: bolitaDrawScheduler handles bolita lifecycle.
            // Exclude bolita draws so the old off-chain closer doesn't mark
            // them 'closed' in DB before bolitaDrawScheduler calls contract.closeDraw().
            if (process.env.BOLITA_CONTRACT_ADDRESS) {
                draws = draws.filter(d => d.draw_type !== 'bolita');
            }

            for (const draw of draws) {
                await this.closeDraw(draw);
            }

            return draws.length;
        } catch (error) {
            console.error('Error cerrando sorteos:', error);
            throw error;
        }
    }

    /**
     * Cerrar un sorteo específico
     */
    async closeDraw(draw) {
        try {
            // Verificar que está en estado correcto
            if (draw.status !== 'open') {
                console.log(`Sorteo ${draw.draw_number} no está abierto (${draw.status})`);
                return null;
            }

            // Cerrar el sorteo
            const closedDraw = await Draw.close(draw.id);

            console.log(`Sorteo cerrado: ${draw.draw_number}`);

            await AuditLog.logDrawAction(
                AUDIT_ACTIONS.DRAW_CLOSED,
                draw.id,
                'system',
                {
                    drawNumber: draw.draw_number,
                    scheduledTime: draw.scheduled_time
                }
            );

            return closedDraw;
        } catch (error) {
            console.error(`Error cerrando sorteo ${draw.id}:`, error);
            throw error;
        }
    }

    /**
     * Forzar cierre de un sorteo (por admin)
     */
    async forceClose(drawId, adminAddress) {
        try {
            const draw = await Draw.findById(drawId);
            if (!draw) {
                throw new Error('Sorteo no encontrado');
            }

            if (draw.status !== 'open' && draw.status !== 'scheduled') {
                throw new Error(`No se puede cerrar sorteo en estado ${draw.status}`);
            }

            const closedDraw = await Draw.close(drawId);

            await AuditLog.logDrawAction(
                AUDIT_ACTIONS.DRAW_CLOSED,
                drawId,
                adminAddress,
                {
                    drawNumber: draw.draw_number,
                    forced: true
                }
            );

            console.log(`Sorteo cerrado forzadamente: ${draw.draw_number} por ${adminAddress}`);

            return closedDraw;
        } catch (error) {
            console.error(`Error forzando cierre de sorteo ${drawId}:`, error);
            throw error;
        }
    }
}

module.exports = new DrawCloser();
