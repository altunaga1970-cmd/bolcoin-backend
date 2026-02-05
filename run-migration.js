// Run migration script
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://labolita:labolita123@localhost:5432/labolita_dev'
});

async function runMigration() {
    const migrationFile = process.argv[2] || 'src/db/migrations/013-add-lottery-columns.sql';
    const sqlPath = path.join(__dirname, migrationFile);

    if (!fs.existsSync(sqlPath)) {
        console.error('Migration file not found:', sqlPath);
        process.exit(1);
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Running migration:', migrationFile);

    try {
        await pool.query(sql);
        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
