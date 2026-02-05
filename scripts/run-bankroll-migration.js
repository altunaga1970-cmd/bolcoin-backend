/**
 * Script para ejecutar la migración del sistema de Bankroll
 * Ejecutar: node scripts/run-bankroll-migration.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function runMigration() {
    const client = await pool.connect();

    try {
        console.log('=== Ejecutando migración del sistema de Bankroll ===\n');

        // Leer archivo de migración
        const migrationPath = path.join(__dirname, '../src/db/migrations/011-bankroll-exposure-system.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        // Ejecutar migración
        console.log('Ejecutando SQL...');
        await client.query(migrationSQL);

        console.log('\n✓ Migración completada exitosamente!\n');

        // Verificar tablas creadas
        const tablesResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name IN ('bankroll_status', 'number_exposure', 'bankroll_transactions', 'draw_settlement')
            ORDER BY table_name
        `);

        console.log('Tablas creadas:');
        tablesResult.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });

        // Verificar estado inicial del bankroll
        const statusResult = await client.query('SELECT * FROM bankroll_status LIMIT 1');
        if (statusResult.rows.length > 0) {
            const status = statusResult.rows[0];
            console.log('\nEstado inicial del sistema:');
            console.log(`  - Bankroll: ${status.bankroll_balance} USDT`);
            console.log(`  - Reserva de premios: ${status.prize_reserve} USDT`);
            console.log(`  - Límite por número: ${status.current_limit_per_number} USDT`);
            console.log(`  - Límite máximo objetivo: ${status.max_limit_per_number} USDT`);
        }

        // Verificar configuración actualizada
        const settingsResult = await client.query(`
            SELECT setting_key, setting_value
            FROM game_settings
            WHERE setting_key LIKE '%multiplier%' OR setting_key LIKE '%limit%' OR setting_key LIKE '%pct%'
            ORDER BY setting_key
        `);

        console.log('\nConfiguración del juego:');
        settingsResult.rows.forEach(row => {
            console.log(`  - ${row.setting_key}: ${row.setting_value}`);
        });

        console.log('\n=== Migración finalizada ===');

    } catch (error) {
        console.error('Error ejecutando migración:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
