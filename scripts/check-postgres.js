const { exec } = require('child_process');
const { Pool } = require('pg');
require('dotenv').config();

// =================================
// SCRIPT PARA VERIFICAR POSTGRESQL
// =================================

console.log('\n=================================');
console.log('🔍 VERIFICACIÓN DE POSTGRESQL');
console.log('=================================\n');

async function checkPostgres() {
    // 1. Verificar si psql está instalado
    console.log('1️⃣  Verificando si PostgreSQL está instalado...\n');

    exec('psql --version', (error, stdout, stderr) => {
        if (error) {
            console.log('❌ PostgreSQL no está instalado o no está en el PATH\n');
            console.log('💡 Opciones para instalar PostgreSQL:\n');
            console.log('   Opción A (Recomendado):');
            console.log('   1. Descargar desde: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads');
            console.log('   2. Ejecutar el instalador');
            console.log('   3. Durante la instalación, anotar la contraseña que configures\n');
            console.log('   Opción B (Docker - más rápido):');
            console.log('   docker run --name labolita-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres\n');
            return;
        }

        console.log('✅ PostgreSQL está instalado');
        console.log(`   Versión: ${stdout.trim()}\n`);

        // 2. Verificar conexión
        checkConnection();
    });
}

async function checkConnection() {
    console.log('2️⃣  Verificando conexión a la base de datos...\n');

    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
        console.log('❌ DATABASE_URL no está configurada en .env\n');
        console.log('💡 Configura tu archivo .env:');
        console.log('   DATABASE_URL=postgresql://postgres:TU_CONTRASEÑA@localhost:5432/labolita\n');
        return;
    }

    console.log(`   URL: ${dbUrl.replace(/:[^:@]+@/, ':***@')}\n`);

    const pool = new Pool({ connectionString: dbUrl });

    try {
        // Intentar conectar
        const result = await pool.query('SELECT NOW()');

        console.log('✅ Conexión exitosa');
        console.log(`   Hora del servidor: ${result.rows[0].now}\n`);

        // 3. Verificar si la base de datos tiene tablas
        console.log('3️⃣  Verificando tablas en la base de datos...\n');

        const tablesResult = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `);

        if (tablesResult.rows.length === 0) {
            console.log('⚠️  La base de datos no tiene tablas\n');
            console.log('💡 Necesitas ejecutar el schema:');
            console.log('   node scripts/setup-db.js\n');
        } else {
            console.log('✅ Tablas encontradas:');
            tablesResult.rows.forEach(row => {
                console.log(`   ✓ ${row.table_name}`);
            });

            console.log('\n4️⃣  Verificando datos...\n');

            // Contar registros
            const usersCount = await pool.query('SELECT COUNT(*) FROM users');
            const drawsCount = await pool.query('SELECT COUNT(*) FROM draws');
            const betsCount = await pool.query('SELECT COUNT(*) FROM bets WHERE is_corrido_child = false');

            console.log(`   Usuarios: ${usersCount.rows[0].count}`);
            console.log(`   Sorteos: ${drawsCount.rows[0].count}`);
            console.log(`   Apuestas: ${betsCount.rows[0].count}\n`);

            if (usersCount.rows[0].count === '0') {
                console.log('💡 No hay usuarios. Crea el usuario admin:');
                console.log('   node scripts/create-admin.js\n');
            }
        }

        console.log('=================================');
        console.log('✅ POSTGRESQL CONFIGURADO CORRECTAMENTE');
        console.log('=================================\n');

        console.log('Próximos pasos:');
        console.log('1. Iniciar servidor: npm run dev');
        console.log('2. Probar API: node scripts/test-api.js\n');

    } catch (error) {
        console.log('❌ Error de conexión:', error.message);
        console.log('\n💡 Soluciones comunes:\n');

        if (error.code === 'ECONNREFUSED') {
            console.log('   PostgreSQL no está corriendo:');
            console.log('   - Windows: Buscar "Services" > PostgreSQL > Start');
            console.log('   - Docker: docker start labolita-postgres\n');
        } else if (error.code === '28P01') {
            console.log('   Contraseña incorrecta:');
            console.log('   - Verifica DATABASE_URL en .env');
            console.log('   - Formato: postgresql://postgres:TU_CONTRASEÑA@localhost:5432/labolita\n');
        } else if (error.code === '3D000') {
            console.log('   La base de datos no existe:');
            console.log('   - Crear con: psql -U postgres -c "CREATE DATABASE labolita;"\n');
        } else {
            console.log(`   Código de error: ${error.code}`);
            console.log(`   Mensaje: ${error.message}\n`);
        }
    } finally {
        await pool.end();
    }
}

checkPostgres();
