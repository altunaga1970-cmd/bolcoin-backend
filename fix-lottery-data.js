// Fix lottery draw totals
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://labolita:labolita123@localhost:5432/labolita_dev'
});

async function fixData() {
    // Update draws with actual ticket counts
    const result = await pool.query(`
        UPDATE draws d
        SET total_bets_amount = COALESCE((
            SELECT SUM(price) FROM lottery_tickets WHERE draw_id = d.id
        ), 0),
        total_tickets = COALESCE((
            SELECT COUNT(*) FROM lottery_tickets WHERE draw_id = d.id
        ), 0),
        bets_count = COALESCE((
            SELECT COUNT(*) FROM lottery_tickets WHERE draw_id = d.id
        ), 0)
        WHERE d.draw_type = 'lottery'
        RETURNING id, draw_number, total_bets_amount, total_tickets
    `);

    console.log('Updated lottery draws:');
    result.rows.forEach(r => console.log(r.draw_number, '- Amount:', r.total_bets_amount, 'USDT, Tickets:', r.total_tickets));

    await pool.end();
}

fixData().catch(console.error);
