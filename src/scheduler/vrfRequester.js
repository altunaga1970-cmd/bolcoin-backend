const Draw = require('../models/Draw');
const AuditLog = require('../models/AuditLog');
const vrfService = require('../services/vrfService');
const { SCHEDULER_CONFIG, AUDIT_ACTIONS } = require('../config/constants');

// =================================
// VRF REQUESTER
// Solicita y procesa números aleatorios VRF
// =================================

class VRFRequester {
    /**
     * Solicitar VRF para sorteos cerrados
     */
    async requestVrfForClosedDraws() {
        try {
            const draws = await Draw.getPendingVrf();

            for (const draw of draws) {
                // Verificar que ha pasado el tiempo de delay
                const closedAt = new Date(draw.scheduled_time);
                const now = new Date();
                const delayMs = SCHEDULER_CONFIG.VRF_REQUEST_DELAY_MINUTES * 60 * 1000;

                if (now.getTime() - closedAt.getTime() >= delayMs) {
                    await this.requestVrf(draw);
                }
            }

            return draws.length;
        } catch (error) {
            console.error('Error solicitando VRF:', error);
            throw error;
        }
    }

    /**
     * Solicitar VRF para un sorteo
     */
    async requestVrf(draw) {
        try {
            console.log(`Solicitando VRF para sorteo ${draw.draw_number}...`);

            const result = await vrfService.requestRandomNumber(draw.id);

            if (result.success) {
                console.log(`VRF solicitado para ${draw.draw_number}: ${result.requestId}`);
            } else {
                console.error(`Error solicitando VRF para ${draw.draw_number}:`, result.error);

                await AuditLog.logDrawAction(
                    AUDIT_ACTIONS.VRF_ERROR,
                    draw.id,
                    'system',
                    { error: result.error }
                );
            }

            return result;
        } catch (error) {
            console.error(`Error en requestVrf para sorteo ${draw.id}:`, error);

            await AuditLog.logError(
                AUDIT_ACTIONS.VRF_ERROR,
                error,
                { drawId: draw.id, drawNumber: draw.draw_number }
            );

            throw error;
        }
    }

    /**
     * Procesar sorteos con VRF completado
     */
    async processCompletedVrf() {
        try {
            const draws = await Draw.getPendingSettlement();

            for (const draw of draws) {
                await this.settleDraw(draw);
            }

            return draws.length;
        } catch (error) {
            console.error('Error procesando VRF completados:', error);
            throw error;
        }
    }

    /**
     * Liquidar un sorteo (calcular ganadores y pagos)
     */
    async settleDraw(draw) {
        try {
            console.log(`Liquidando sorteo ${draw.draw_number}...`);

            // Importar servicio de pagos
            const payoutService = require('../services/payoutService');

            // Procesar pagos
            const result = await payoutService.processDraw(draw.id);

            // Actualizar estado del sorteo
            await Draw.setSettled(draw.id, {
                total_bets_amount: result.totalBets,
                total_payouts_amount: result.totalPayouts,
                bets_count: result.betsCount,
                winners_count: result.winnersCount
            });

            // Si es La Bolita, completar directamente
            // Si es La Fortuna, necesita Merkle roots primero
            if (draw.draw_type !== 'lottery') {
                await Draw.complete(draw.id);

                await AuditLog.logDrawAction(
                    AUDIT_ACTIONS.DRAW_COMPLETED,
                    draw.id,
                    'system',
                    {
                        winningNumber: draw.winning_number,
                        totalBets: result.totalBets,
                        totalPayouts: result.totalPayouts,
                        winnersCount: result.winnersCount
                    }
                );
            } else {
                await AuditLog.logDrawAction(
                    AUDIT_ACTIONS.DRAW_SETTLED,
                    draw.id,
                    'system',
                    {
                        lotteryNumbers: draw.lottery_numbers,
                        lotteryKey: draw.lottery_key,
                        totalBets: result.totalBets,
                        winnersCount: result.winnersCount
                    }
                );
            }

            console.log(`Sorteo ${draw.draw_number} liquidado: ${result.winnersCount} ganadores, ${result.totalPayouts} USDT`);

            return result;
        } catch (error) {
            console.error(`Error liquidando sorteo ${draw.id}:`, error);

            await AuditLog.logError(
                AUDIT_ACTIONS.SYSTEM_ERROR,
                error,
                { drawId: draw.id, drawNumber: draw.draw_number, action: 'settle' }
            );

            throw error;
        }
    }

    /**
     * Verificar timeouts de VRF
     */
    async checkVrfTimeouts() {
        try {
            const draws = await Draw.getAwaitingVrf();
            const now = new Date();
            const timeoutMs = SCHEDULER_CONFIG.VRF_TIMEOUT_MINUTES * 60 * 1000;

            for (const draw of draws) {
                const requestedAt = new Date(draw.vrf_requested_at);

                if (now.getTime() - requestedAt.getTime() > timeoutMs) {
                    console.warn(`VRF timeout para sorteo ${draw.draw_number}`);

                    await AuditLog.logDrawAction(
                        AUDIT_ACTIONS.VRF_ERROR,
                        draw.id,
                        'system',
                        { error: 'VRF timeout', requestedAt: requestedAt.toISOString() }
                    );

                    // TODO: Implementar retry o fallback
                }
            }
        } catch (error) {
            console.error('Error verificando timeouts VRF:', error);
        }
    }
}

module.exports = new VRFRequester();
