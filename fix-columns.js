// Fix missing columns in lottery_tickets
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://labolita:labolita123@localhost:5432/labolita_dev'
});

async function fix() {
    console.log('Adding missing columns to lottery_tickets...');

    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lottery_tickets' AND column_name = 'prize_amount') THEN
                ALTER TABLE lottery_tickets ADD COLUMN prize_amount DECIMAL(14,2) DEFAULT 0;
                RAISE NOTICE 'Added prize_amount column';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lottery_tickets' AND column_name = 'claimed_at') THEN
                ALTER TABLE lottery_tickets ADD COLUMN claimed_at TIMESTAMP;
                RAISE NOTICE 'Added claimed_at column';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lottery_tickets' AND column_name = 'matches') THEN
                ALTER TABLE lottery_tickets ADD COLUMN matches INTEGER DEFAULT 0;
                RAISE NOTICE 'Added matches column';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lottery_tickets' AND column_name = 'key_match') THEN
                ALTER TABLE lottery_tickets ADD COLUMN key_match BOOLEAN DEFAULT FALSE;
                RAISE NOTICE 'Added key_match column';
            END IF;
        END $$
    `);

    console.log('Columns added successfully!');
    await pool.end();
}

fix().catch(console.error);
