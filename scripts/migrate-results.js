const { Pool } = require('pg');
require('dotenv').config();

// =================================
// MIGRACIÓN: Resultados Separados
// =================================

console.log('\n=================================');
console.log('MIGRACION: Resultados Separados');
console.log('=================================\n');

async function migrate() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('1. Conectando a la base de datos...');
        await pool.query('SELECT NOW()');
        console.log('   Conexion exitosa\n');

        console.log('2. Agregando columnas para resultados separados...');

        // Verificar si las columnas ya existen
        const checkColumns = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'draws'
            AND column_name IN ('winning_fijos', 'winning_centenas', 'winning_parles')
        `);

        if (checkColumns.rows.length > 0) {
            console.log('   Las columnas ya existen, saltando...\n');
        } else {
            await pool.query(`
                ALTER TABLE draws
                ADD COLUMN IF NOT EXISTS winning_fijos CHAR(2),
                ADD COLUMN IF NOT EXISTS winning_centenas CHAR(3),
                ADD COLUMN IF NOT EXISTS winning_parles CHAR(4)
            `);
            console.log('   Columnas agregadas exitosamente\n');
        }

        console.log('3. Migrando datos existentes (si hay)...');
        // Si hay sorteos completados con winning_number, migrar los datos
        const result = await pool.query(`
            UPDATE draws
            SET
                winning_fijos = SUBSTRING(winning_number FROM 3 FOR 2),
                winning_centenas = SUBSTRING(winning_number FROM 2 FOR 3),
                winning_parles = winning_number
            WHERE winning_number IS NOT NULL
            AND winning_fijos IS NULL
        `);
        console.log(`   ${result.rowCount} sorteos migrados\n`);

        console.log('=================================');
        console.log('MIGRACION COMPLETADA');
        console.log('=================================\n');

    } catch (error) {
        console.error('Error en migracion:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
