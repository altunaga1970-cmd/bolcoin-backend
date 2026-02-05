const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// =================================
// SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS
// =================================

console.log('\n=================================');
console.log('🗄️  CONFIGURACIÓN DE BASE DE DATOS');
console.log('=================================\n');

async function setupDatabase() {
    // Extraer información de la conexión
    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
        console.error('❌ Error: DATABASE_URL no está configurada en .env');
        process.exit(1);
    }

    console.log('📋 URL de conexión:', dbUrl.replace(/:[^:@]+@/, ':***@'));

    // Crear pool de conexión
    const pool = new Pool({
        connectionString: dbUrl
    });

    try {
        // 1. Probar conexión
        console.log('\n1️⃣  Probando conexión a PostgreSQL...');
        await pool.query('SELECT NOW()');
        console.log('✅ Conexión exitosa\n');

        // 2. Verificar si la base de datos existe
        console.log('2️⃣  Verificando base de datos...');
        const dbName = dbUrl.split('/').pop().split('?')[0];
        console.log(`📦 Base de datos: ${dbName}`);

        // 3. Leer el schema SQL
        console.log('\n3️⃣  Leyendo schema SQL...');
        const schemaPath = path.join(__dirname, '../src/db/schema.sql');

        if (!fs.existsSync(schemaPath)) {
            console.error('❌ Error: No se encontró el archivo schema.sql');
            process.exit(1);
        }

        const schema = fs.readFileSync(schemaPath, 'utf8');
        console.log('✅ Schema leído correctamente\n');

        // 4. Ejecutar el schema
        console.log('4️⃣  Ejecutando schema SQL...');
        console.log('⚠️  Esto eliminará todas las tablas existentes y las recreará\n');

        await pool.query(schema);
        console.log('✅ Schema ejecutado correctamente\n');

        // 5. Verificar tablas creadas
        console.log('5️⃣  Verificando tablas creadas...');
        const tablesResult = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `);

        console.log('\n📊 Tablas creadas:');
        tablesResult.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });

        // 6. Contar registros iniciales
        console.log('\n6️⃣  Verificando datos iniciales...');
        const settingsResult = await pool.query('SELECT COUNT(*) FROM game_settings');
        console.log(`   ✓ game_settings: ${settingsResult.rows[0].count} registros`);

        console.log('\n=================================');
        console.log('✅ BASE DE DATOS CONFIGURADA');
        console.log('=================================\n');

        console.log('Próximos pasos:');
        console.log('1. Crear usuario admin: node scripts/create-admin.js');
        console.log('2. Cargar datos de prueba: node scripts/seed-data.js');
        console.log('3. Iniciar servidor: npm run dev\n');

    } catch (error) {
        console.error('\n❌ Error configurando base de datos:', error.message);

        if (error.code === '42P01') {
            console.error('\n💡 Sugerencia: Parece que hay un error en el schema SQL');
        } else if (error.code === '3D000') {
            console.error('\n💡 Sugerencia: La base de datos no existe. Créala con:');
            console.error('   psql -U postgres -c "CREATE DATABASE labolita;"');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('\n💡 Sugerencia: PostgreSQL no está corriendo');
        } else if (error.code === '28P01') {
            console.error('\n💡 Sugerencia: Contraseña incorrecta en DATABASE_URL (.env)');
        }

        process.exit(1);
    } finally {
        await pool.end();
    }
}

setupDatabase();
