const drawScheduler = require('./drawScheduler');
const drawCloser = require('./drawCloser');
const vrfRequester = require('./vrfRequester');
const dataCleanupScheduler = require('./dataCleanup');
const { SCHEDULER_CONFIG, AUDIT_ACTIONS } = require('../config/constants');
const AuditLog = require('../models/AuditLog');
const kenoSessionService = require('../services/kenoSessionService');
const gameConfigService = require('../services/gameConfigService');
const kenoPoolHealthService = require('../services/kenoPoolHealthService');
const kenoVrfRequester = require('./kenoVrfRequester');

// =================================
// SCHEDULER PRINCIPAL
// =================================

class Scheduler {
    constructor() {
        this.intervals = [];
        this.isRunning = false;
    }

    /**
     * Iniciar el scheduler
     */
    async start() {
        if (this.isRunning) {
            console.log('Scheduler ya está corriendo');
            return;
        }

        console.log('Iniciando Scheduler...');
        this.isRunning = true;

        // Log de inicio
        await AuditLog.logSystemAction(AUDIT_ACTIONS.SCHEDULER_STARTED, {
            checkInterval: SCHEDULER_CONFIG.CHECK_INTERVAL_MS
        });

        // Ejecutar verificaciones iniciales
        await this.runAllChecks();

        // Programar verificaciones periódicas
        const mainInterval = setInterval(async () => {
            await this.runAllChecks();
        }, SCHEDULER_CONFIG.CHECK_INTERVAL_MS);

        this.intervals.push(mainInterval);

        // Iniciar scheduler de limpieza de datos
        dataCleanupScheduler.start();

        console.log(`Scheduler iniciado. Verificaciones cada ${SCHEDULER_CONFIG.CHECK_INTERVAL_MS / 1000}s`);
    }

    /**
     * Detener el scheduler
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }

        console.log('Deteniendo Scheduler...');

        // Limpiar intervalos
        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];

        // Detener scheduler de limpieza
        dataCleanupScheduler.stop();

        this.isRunning = false;

        await AuditLog.logSystemAction(AUDIT_ACTIONS.SCHEDULER_STOPPED);

        console.log('Scheduler detenido');
    }

    /**
     * Ejecutar todas las verificaciones
     */
    async runAllChecks() {
        try {
            // 1. Crear sorteos automáticamente
            await drawScheduler.createUpcomingDraws();

            // 2. Abrir sorteos programados
            await drawScheduler.openScheduledDraws();

            // 3. Cerrar sorteos que están por empezar
            await drawCloser.closeDrawsBeforeTime();

            // 4. Solicitar VRF para sorteos cerrados
            await vrfRequester.requestVrfForClosedDraws();

            // 5. Procesar sorteos con VRF completado
            await vrfRequester.processCompletedVrf();

            // 6. Liquidar sesiones de Keno antiguas (auto-expire)
            await this.settleOldKenoSessions();

            // 7. Verificar salud del pool de Keno y auto-liquidar si es necesario
            await this.checkKenoPoolHealth();

            // 8. Registrar snapshot del pool para historial (cada hora)
            await this.recordKenoPoolSnapshot();

            // 9. Ejecutar tareas VRF de Keno (batches)
            await this.runKenoVrfTasks();

        } catch (error) {
            console.error('Error en verificaciones del scheduler:', error);
            await AuditLog.logError(AUDIT_ACTIONS.SYSTEM_ERROR, error, {
                component: 'scheduler',
                action: 'runAllChecks'
            });
        }
    }

    /**
     * Liquidar sesiones de Keno que exceden el tiempo máximo
     */
    async settleOldKenoSessions() {
        try {
            const maxHours = await gameConfigService.getConfigValue('keno_max_session_hours', 24);
            const results = await kenoSessionService.settleOldSessions(maxHours);

            if (results.length > 0) {
                console.log(`[Scheduler] Auto-settled ${results.length} old Keno sessions`);

                // Log each settlement
                for (const result of results) {
                    if (result.success) {
                        await AuditLog.logSystemAction(AUDIT_ACTIONS.KENO_SESSION_AUTO_SETTLED, {
                            wallet: result.wallet,
                            netResult: result.netResult,
                            gamesPlayed: result.gamesPlayed,
                            txHash: result.txHash
                        });
                    }
                }
            }

            return results;
        } catch (error) {
            console.error('[Scheduler] Error settling old Keno sessions:', error);
            await AuditLog.logError(AUDIT_ACTIONS.SYSTEM_ERROR, error, {
                component: 'scheduler',
                action: 'settleOldKenoSessions'
            });
            return [];
        }
    }

    /**
     * Verificar salud del pool de Keno y auto-liquidar si es necesario
     */
    async checkKenoPoolHealth() {
        try {
            const result = await kenoPoolHealthService.autoSettleOnLowPool();

            if (result.triggered) {
                const auditAction = result.poolHealthBefore?.status === 'critical'
                    ? AUDIT_ACTIONS.KENO_POOL_CRITICAL
                    : AUDIT_ACTIONS.KENO_POOL_LOW;

                await AuditLog.logSystemAction(auditAction, {
                    poolHealthBefore: result.poolHealthBefore,
                    poolHealthAfter: result.poolHealthAfter,
                    sessionsSettled: result.sessionsSettled.length,
                    errors: result.errors.length
                });

                if (result.sessionsSettled.length > 0) {
                    console.log(`[Scheduler] Pool health check: auto-settled ${result.sessionsSettled.length} sessions`);
                }
            }

            return result;
        } catch (error) {
            console.error('[Scheduler] Error checking Keno pool health:', error);
            await AuditLog.logError(AUDIT_ACTIONS.SYSTEM_ERROR, error, {
                component: 'scheduler',
                action: 'checkKenoPoolHealth'
            });
            return { triggered: false };
        }
    }

    /**
     * Registrar snapshot del pool para historial
     * Solo registra una vez por hora para evitar exceso de datos
     */
    async recordKenoPoolSnapshot() {
        try {
            // Solo registrar en el minuto 0 de cada hora
            const now = new Date();
            if (now.getMinutes() === 0) {
                await kenoPoolHealthService.recordPoolSnapshot();
            }
        } catch (error) {
            // No es critico, solo log
            console.error('[Scheduler] Error recording pool snapshot:', error.message);
        }
    }

    /**
     * Ejecutar tareas VRF de Keno
     * Crea batches, envia solicitudes y procesa callbacks
     */
    async runKenoVrfTasks() {
        try {
            const results = await kenoVrfRequester.runVrfTasks();

            // Log resultados significativos
            if (results.batchCreation?.created) {
                await AuditLog.logSystemAction(AUDIT_ACTIONS.KENO_VRF_BATCH_CREATED, {
                    batchId: results.batchCreation.batchId,
                    gamesCount: results.batchCreation.gamesCount
                });
            }

            if (results.vrfVerification?.length > 0) {
                for (const verification of results.vrfVerification) {
                    if (verification.success) {
                        await AuditLog.logSystemAction(AUDIT_ACTIONS.KENO_VRF_BATCH_VERIFIED, {
                            batchId: verification.batchId,
                            gamesVerified: verification.gamesVerified
                        });
                    }
                }
            }

            return results;
        } catch (error) {
            console.error('[Scheduler] Error running Keno VRF tasks:', error);
            await AuditLog.logError(AUDIT_ACTIONS.KENO_VRF_BATCH_FAILED, error, {
                component: 'scheduler',
                action: 'runKenoVrfTasks'
            });
            return { error: error.message };
        }
    }

    /**
     * Verificar si está corriendo
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            intervalCount: this.intervals.length,
            checkIntervalMs: SCHEDULER_CONFIG.CHECK_INTERVAL_MS,
            dataCleanup: dataCleanupScheduler.getStatus()
        };
    }
}

// Singleton
const scheduler = new Scheduler();

module.exports = scheduler;
