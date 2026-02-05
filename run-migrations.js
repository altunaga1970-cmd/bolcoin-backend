// Migration runner script
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigrations() {
  console.log('Conectando a la base de datos...');

  const client = await pool.connect();

  try {
    // Run main schema first
    console.log('\n📦 Ejecutando schema.sql...');
    const schemaPath = path.join(__dirname, 'src/db/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schema);
      console.log('✅ schema.sql ejecutado');
    }

    // Run migrations in order
    const migrationsDir = path.join(__dirname, 'src/db/migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        console.log(`\n📦 Ejecutando ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        try {
          await client.query(sql);
          console.log(`✅ ${file} ejecutado`);
        } catch (err) {
          if (err.message.includes('already exists') || err.message.includes('ya existe')) {
            console.log(`⚠️  ${file} - tablas ya existen (OK)`);
          } else {
            console.error(`❌ Error en ${file}:`, err.message);
          }
        }
      }
    }

    console.log('\n✅ Migraciones completadas!');
  } catch (error) {
    console.error('❌ Error ejecutando migraciones:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
