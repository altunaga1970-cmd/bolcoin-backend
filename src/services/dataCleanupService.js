const { query, getClient } = require('../config/database');

// =================================
// DATA CLEANUP SERVICE
// Limpieza automatica de datos antiguos
// =================================

const DEFAULT_RETENTION_DAYS = 7;

/**
 * Ejecutar limpieza completa de datos
 * @param {number} retentionDays - Dias de retencion de datos detallados
 */
async function runCleanup(retentionDays = DEFAULT_RETENTION_DAYS) {
    const client = await getClient();
    const cleanupLog = {
        records_deleted: 0,
        tables_affected: {},
        metrics_aggregated: {}
    };

    try {
        await client.query('BEGIN');

        // 1. Crear registro de log
        const logResult = await client.query(`
            INSERT INTO data_cleanup_log (cleanup_type, retention_days, status)
            VALUES ('scheduled', $1, 'running')
            RETURNING id
        `, [retentionDays]);
        const logId = logResult.rows[0].id;

        console.log(`[DataCleanup] Iniciando limpieza (ID: ${logId}), retencion: ${retentionDays} dias`);

        // 2. Agregar metricas de los dias que se van a eliminar
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        // Agregar metricas diarias para los dias sin agregar
        const daysToAggregate = await client.query(`
            SELECT DISTINCT DATE(created_at) as date
            FROM bets
            WHERE DATE(created_at) < $1
            AND DATE(created_at) NOT IN (SELECT date FROM daily_metrics)
            ORDER BY date
        `, [cutoffDate]);

        for (const row of daysToAggregate.rows) {
            await client.query(`SELECT aggregate_daily_metrics($1)`, [row.date]);
            cleanupLog.metrics_aggregated[row.date] = true;
        }

        console.log(`[DataCleanup] Metricas agregadas para ${daysToAggregate.rows.length} dias`);

        // 3. Eliminar apuestas antiguas de sorteos completados
        // Solo eliminar si el sorteo ya esta completado y tiene metricas agregadas
        const deletedBets = await client.query(`
            DELETE FROM bets
            WHERE id IN (
                SELECT b.id FROM bets b
                JOIN draws d ON b.draw_id = d.id
                WHERE d.status = 'completed'
                AND b.created_at < $1
                AND DATE(b.created_at) IN (SELECT date FROM daily_metrics)
            )
            RETURNING id
        `, [cutoffDate]);

        cleanupLog.tables_affected.bets = deletedBets.rowCount;
        cleanupLog.records_deleted += deletedBets.rowCount;
        console.log(`[DataCleanup] Eliminadas ${deletedBets.rowCount} apuestas`);

        // 4. Eliminar transacciones antiguas (mantener las ultimas por usuario)
        const deletedTransactions = await client.query(`
            DELETE FROM transactions
            WHERE id IN (
                SELECT t.id FROM transactions t
                WHERE t.created_at < $1
                AND DATE(t.created_at) IN (SELECT date FROM daily_metrics)
                AND t.id NOT IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
                        FROM transactions
                    ) sub WHERE rn <= 100
                )
            )
            RETURNING id
        `, [cutoffDate]);

        cleanupLog.tables_affected.transactions = deletedTransactions.rowCount;
        cleanupLog.records_deleted += deletedTransactions.rowCount;
        console.log(`[DataCleanup] Eliminadas ${deletedTransactions.rowCount} transacciones`);

        // 5. Eliminar sorteos completados muy antiguos (mantener datos basicos)
        // Solo eliminar sorteos de mas de 90 dias
        const oldCutoff = new Date();
        oldCutoff.setDate(oldCutoff.getDate() - 90);

        const deletedDraws = await client.query(`
            DELETE FROM draws
            WHERE status = 'completed'
            AND scheduled_time < $1
            AND id NOT IN (SELECT DISTINCT draw_id FROM bets)
            RETURNING id
        `, [oldCutoff]);

        cleanupLog.tables_affected.draws = deletedDraws.rowCount;
        cleanupLog.records_deleted += deletedDraws.rowCount;
        console.log(`[DataCleanup] Eliminados ${deletedDraws.rowCount} sorteos antiguos`);

        // 6. Limpiar logs de limpieza antiguos (mantener ultimos 30)
        const deletedLogs = await client.query(`
            DELETE FROM data_cleanup_log
            WHERE id NOT IN (
                SELECT id FROM data_cleanup_log
                ORDER BY started_at DESC
                LIMIT 30
            )
            RETURNING id
        `);

        cleanupLog.tables_affected.data_cleanup_log = deletedLogs.rowCount;

        // 7. Actualizar metricas mensuales
        const currentDate = new Date();
        const lastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        await client.query(`SELECT aggregate_monthly_metrics($1, $2)`, [lastMonth.getFullYear(), lastMonth.getMonth() + 1]);

        // 8. Actualizar log de limpieza
        await client.query(`
            UPDATE data_cleanup_log
            SET
                records_deleted = $1,
                tables_affected = $2,
                metrics_aggregated = $3,
                completed_at = NOW(),
                status = 'completed'
            WHERE id = $4
        `, [cleanupLog.records_deleted, JSON.stringify(cleanupLog.tables_affected), JSON.stringify(cleanupLog.metrics_aggregated), logId]);

        await client.query('COMMIT');

        console.log(`[DataCleanup] Limpieza completada. Total eliminados: ${cleanupLog.records_deleted}`);

        return {
            success: true,
            logId,
            ...cleanupLog
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[DataCleanup] Error durante limpieza:', error);

        // Intentar actualizar log con error
        try {
            await query(`
                UPDATE data_cleanup_log
                SET status = 'failed', error_message = $1, completed_at = NOW()
                WHERE id = (SELECT id FROM data_cleanup_log ORDER BY started_at DESC LIMIT 1)
            `, [error.message]);
        } catch (logError) {
            console.error('[DataCleanup] Error actualizando log:', logError);
        }

        throw error;
    } finally {
        client.release();
    }
}

/**
 * Obtener estado de la ultima limpieza
 */
async function getCleanupStatus() {
    const lastCleanup = await query(`
        SELECT *
        FROM data_cleanup_log
        ORDER BY started_at DESC
        LIMIT 1
    `);

    const stats = await query(`
        SELECT
            (SELECT COUNT(*) FROM bets) as total_bets,
            (SELECT COUNT(*) FROM transactions) as total_transactions,
            (SELECT COUNT(*) FROM draws) as total_draws,
            (SELECT COUNT(*) FROM daily_metrics) as total_daily_metrics,
            (SELECT COUNT(*) FROM monthly_metrics) as total_monthly_metrics
    `);

    // Calcular tamano aproximado de datos
    const oldData = await query(`
        SELECT
            COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '7 days') as old_bets
        FROM bets
    `);

    return {
        lastCleanup: lastCleanup.rows[0] || null,
        currentStats: {
            bets: parseInt(stats.rows[0].total_bets),
            transactions: parseInt(stats.rows[0].total_transactions),
            draws: parseInt(stats.rows[0].total_draws),
            dailyMetrics: parseInt(stats.rows[0].total_daily_metrics),
            monthlyMetrics: parseInt(stats.rows[0].total_monthly_metrics)
        },
        pendingCleanup: {
            oldBets: parseInt(oldData.rows[0].old_bets)
        }
    };
}

/**
 * Obtener historial de limpiezas
 */
async function getCleanupHistory(limit = 10) {
    const result = await query(`
        SELECT *
        FROM data_cleanup_log
        ORDER BY started_at DESC
        LIMIT $1
    `, [limit]);

    return result.rows;
}

/**
 * Verificar si es necesario ejecutar limpieza
 */
async function shouldRunCleanup() {
    // Verificar ultima limpieza
    const lastCleanup = await query(`
        SELECT started_at
        FROM data_cleanup_log
        WHERE status = 'completed'
        ORDER BY started_at DESC
        LIMIT 1
    `);

    if (lastCleanup.rows.length === 0) {
        return true; // Nunca se ha ejecutado
    }

    const lastRun = new Date(lastCleanup.rows[0].started_at);
    const daysSinceLastRun = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60 * 24);

    // Ejecutar si han pasado mas de 6 dias (semanal)
    return daysSinceLastRun >= 6;
}

/**
 * Agregar metricas para un rango de fechas
 */
async function aggregateMetricsRange(dateFrom, dateTo) {
    const client = await getClient();

    try {
        const from = new Date(dateFrom);
        const to = new Date(dateTo);

        let current = new Date(from);
        let aggregated = 0;

        while (current <= to) {
            await client.query(`SELECT aggregate_daily_metrics($1)`, [current]);
            aggregated++;
            current.setDate(current.getDate() + 1);
        }

        console.log(`[DataCleanup] Agregadas metricas para ${aggregated} dias`);

        return { aggregated };
    } finally {
        client.release();
    }
}

/**
 * Forzar regeneracion de metricas mensuales
 */
async function regenerateMonthlyMetrics(year, month) {
    await query(`SELECT aggregate_monthly_metrics($1, $2)`, [year, month]);
    return { success: true, year, month };
}

module.exports = {
    runCleanup,
    getCleanupStatus,
    getCleanupHistory,
    shouldRunCleanup,
    aggregateMetricsRange,
    regenerateMonthlyMetrics,
    DEFAULT_RETENTION_DAYS
};
