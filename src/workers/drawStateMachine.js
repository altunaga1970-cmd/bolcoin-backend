const Draw = require('../models/Draw');
const AuditLog = require('../models/AuditLog');
const { DRAW_STATE_MACHINE, AUDIT_ACTIONS } = require('../config/constants');

// =================================
// DRAW STATE MACHINE
// Gestiona las transiciones de estado de los sorteos
// =================================

class DrawStateMachine {
    /**
     * Transiciones de estado permitidas
     */
    static TRANSITIONS = {
        // La Bolita
        scheduled: ['open'],
        open: ['closed'],
        closed: ['vrf_requested'],
        vrf_requested: ['vrf_fulfilled'],
        vrf_fulfilled: ['settled'],
        settled: ['completed', 'roots_published'],
        // La Fortuna (adicionales)
        roots_published: ['claims_open'],
        claims_open: ['completed']
    };

    /**
     * Verificar si una transición es válida
     */
    static isValidTransition(fromState, toState) {
        const allowed = this.TRANSITIONS[fromState];
        return allowed && allowed.includes(toState);
    }

    /**
     * Ejecutar transición de estado
     * @param {number} drawId - ID del sorteo
     * @param {string} newState - Nuevo estado
     * @param {string} actorAddress - Dirección del actor (o 'system')
     * @param {Object} metadata - Metadatos adicionales
     */
    static async transition(drawId, newState, actorAddress = 'system', metadata = {}) {
        const draw = await Draw.findById(drawId);

        if (!draw) {
            throw new Error('Sorteo no encontrado');
        }

        const currentState = draw.status;

        // Verificar transición válida
        if (!this.isValidTransition(currentState, newState)) {
            throw new Error(
                `Transición inválida: ${currentState} -> ${newState}. ` +
                `Transiciones permitidas: ${this.TRANSITIONS[currentState]?.join(', ') || 'ninguna'}`
            );
        }

        // Ejecutar transición según el nuevo estado
        let updatedDraw;
        switch (newState) {
            case 'open':
                updatedDraw = await Draw.open(drawId);
                break;
            case 'closed':
                updatedDraw = await Draw.close(drawId);
                break;
            case 'vrf_requested':
                updatedDraw = await Draw.setVrfRequested(drawId, metadata.requestId);
                break;
            case 'vrf_fulfilled':
                updatedDraw = await Draw.setVrfFulfilled(drawId, metadata.randomWord, metadata.winningNumber);
                break;
            case 'settled':
                updatedDraw = await Draw.setSettled(drawId, metadata.stats);
                break;
            case 'roots_published':
                updatedDraw = await Draw.publishMerkleRoot(drawId, metadata.merkleRoot, metadata.claimsDeadline);
                break;
            case 'claims_open':
                updatedDraw = await Draw.openClaims(drawId);
                break;
            case 'completed':
                updatedDraw = await Draw.complete(drawId);
                break;
            default:
                throw new Error(`Estado no reconocido: ${newState}`);
        }

        // Registrar en audit log
        const action = this.getAuditAction(newState);
        if (action) {
            await AuditLog.logDrawAction(action, drawId, actorAddress, {
                fromState: currentState,
                toState: newState,
                ...metadata
            });
        }

        console.log(`Sorteo ${draw.draw_number}: ${currentState} -> ${newState}`);

        return updatedDraw;
    }

    /**
     * Obtener acción de audit log para un estado
     */
    static getAuditAction(state) {
        const actions = {
            open: AUDIT_ACTIONS.DRAW_OPENED,
            closed: AUDIT_ACTIONS.DRAW_CLOSED,
            vrf_requested: AUDIT_ACTIONS.DRAW_VRF_REQUESTED,
            vrf_fulfilled: AUDIT_ACTIONS.DRAW_VRF_FULFILLED,
            settled: AUDIT_ACTIONS.DRAW_SETTLED,
            completed: AUDIT_ACTIONS.DRAW_COMPLETED
        };
        return actions[state] || null;
    }

    /**
     * Obtener siguiente estado posible
     */
    static getNextStates(currentState) {
        return this.TRANSITIONS[currentState] || [];
    }

    /**
     * Obtener historial de estados de un sorteo
     */
    static async getStateHistory(drawId) {
        const logs = await AuditLog.findByEntity('draw', drawId);
        return logs.filter(log =>
            log.action.startsWith('draw_') &&
            log.details?.fromState !== undefined
        ).map(log => ({
            timestamp: log.created_at,
            fromState: log.details.fromState,
            toState: log.details.toState,
            actor: log.actor_address
        }));
    }

    /**
     * Verificar si un sorteo puede avanzar automáticamente
     */
    static async canAutoAdvance(draw) {
        switch (draw.status) {
            case 'scheduled':
                // Puede abrir si la hora programada está cerca
                return true;
            case 'open':
                // Puede cerrar si está cerca de la hora del sorteo
                const now = new Date();
                const scheduledTime = new Date(draw.scheduled_time);
                return now >= scheduledTime;
            case 'closed':
                // Puede solicitar VRF
                return true;
            case 'vrf_requested':
                // Espera respuesta de VRF
                return false;
            case 'vrf_fulfilled':
                // Puede liquidar
                return true;
            case 'settled':
                // La Bolita puede completar, La Fortuna necesita roots
                return draw.draw_type !== 'lottery';
            case 'roots_published':
                // Puede abrir claims
                return true;
            case 'claims_open':
                // Puede completar si pasó el deadline
                const deadline = new Date(draw.claims_deadline);
                return new Date() >= deadline;
            default:
                return false;
        }
    }
}

module.exports = DrawStateMachine;
