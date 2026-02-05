const dataCleanupService = require('../services/dataCleanupService');
const metricsService = require('../services/metricsService');
const AuditLog = require('../models/AuditLog');
const { AUDIT_ACTIONS } = require('../config/constants');

// =================================
// DATA CLEANUP SCHEDULER
// Ejecuta limpieza automatica de datos antiguos
// Programado: Domingos a las 3:00 AM
// =================================

const CLEANUP_DAY = 0; // Domingo
const CLEANUP_HOUR = 3; // 3:00 AM
const CHECK_INTERVAL = 60 * 60 * 1000; // Verificar cada hora

class DataCleanupScheduler {
    constructor() {
        this.interval = null;
        this.isRunning = false;
        this.lastRun = null;
    }

    /**
     * Iniciar el scheduler de limpieza
     */
    start() {
        if (this.interval) {
            console.log('[DataCleanupScheduler] Ya esta corriendo');
            return;
        }

        console.log('[DataCleanupScheduler] Iniciando scheduler de limpieza');
        console.log(`[DataCleanupScheduler] Programado para: Domingos a las ${CLEANUP_HOUR}:00 AM`);

        // Verificar inmediatamente
        this.checkAndRun();

        // Programar verificaciones periodicas
        this.interval = setInterval(() => {
            this.checkAndRun();
        }, CHECK_INTERVAL);
    }

    /**
     * Detener el scheduler
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            console.log('[DataCleanupScheduler] Scheduler detenido');
        }
    }

    /**
     * Verificar si es momento de ejecutar y ejecutar si corresponde
     */
    async checkAndRun() {
        const now = new Date();
        const day = now.getDay();
        const hour = now.getHours();

        // Solo ejecutar domingos a las 3 AM
        if (day !== CLEANUP_DAY || hour !== CLEANUP_HOUR) {
            return;
        }

        // Evitar ejecutar multiples veces en la misma hora
        if (this.lastRun) {
            const hoursSinceLastRun = (now - this.lastRun) / (1000 * 60 * 60);
            if (hoursSinceLastRun < 23) {
                return;
            }
        }

        // Verificar si ya se ejecuto recientemente (doble check con BD)
        const shouldRun = await dataCleanupService.shouldRunCleanup();
        if (!shouldRun) {
            console.log('[DataCleanupScheduler] Limpieza ya fue ejecutada recientemente');
            return;
        }

        await this.runCleanup();
    }

    /**
     * Ejecutar limpieza
     */
    async runCleanup() {
        if (this.isRunning) {
            console.log('[DataCleanupScheduler] Limpieza ya en progreso, saltando');
            return;
        }

        this.isRunning = true;
        this.lastRun = new Date();

        console.log('[DataCleanupScheduler] Iniciando limpieza programada...');

        try {
            // Primero agregar metricas del dia anterior
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            await metricsService.aggregateDayMetrics(yesterday);
            console.log('[DataCleanupScheduler] Metricas del dia anterior agregadas');

            // Ejecutar limpieza
            const result = await dataCleanupService.runCleanup();

            console.log(`[DataCleanupScheduler] Limpieza completada: ${result.records_deleted} registros eliminados`);

            // Log de auditoria
            await AuditLog.logSystemAction(AUDIT_ACTIONS.DATA_CLEANUP || 'DATA_CLEANUP', {
                records_deleted: result.records_deleted,
                tables_affected: result.tables_affected
            });

        } catch (error) {
            console.error('[DataCleanupScheduler] Error en limpieza:', error);

            await AuditLog.logError(AUDIT_ACTIONS.SYSTEM_ERROR || 'SYSTEM_ERROR', error, {
                component: 'DataCleanupScheduler',
                action: 'runCleanup'
            });
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Forzar ejecucion de limpieza (para uso manual)
     */
    async forceRun() {
        console.log('[DataCleanupScheduler] Ejecutando limpieza forzada');
        await this.runCleanup();
    }

    /**
     * Obtener estado del scheduler
     */
    getStatus() {
        const now = new Date();
        const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
        const nextRun = new Date(now);
        nextRun.setDate(now.getDate() + daysUntilSunday);
        nextRun.setHours(CLEANUP_HOUR, 0, 0, 0);

        // Si ya paso la hora de hoy domingo, es para el proximo
        if (now.getDay() === CLEANUP_DAY && now.getHours() >= CLEANUP_HOUR) {
            nextRun.setDate(nextRun.getDate() + 7);
        }

        return {
            isActive: !!this.interval,
            isRunning: this.isRunning,
            lastRun: this.lastRun,
            nextScheduledRun: nextRun,
            schedule: `Domingos a las ${CLEANUP_HOUR}:00 AM`
        };
    }
}

// Singleton
const dataCleanupScheduler = new DataCleanupScheduler();

module.exports = dataCleanupScheduler;
