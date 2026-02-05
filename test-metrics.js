// Test metrics service
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://labolita:labolita123@localhost:5432/labolita_dev'
});

async function testMetrics() {
    console.log('=== TESTING METRICS ===\n');

    // La Bolita bets today
    const betsToday = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE is_corrido_child = false) as count,
            COALESCE(SUM(amount) FILTER (WHERE is_corrido_child = false), 0) as total
        FROM bets
        WHERE DATE(created_at) = CURRENT_DATE
    `);
    console.log('La Bolita (today):');
    console.log('  Bets:', betsToday.rows[0].count);
    console.log('  Amount:', betsToday.rows[0].total, 'USDT');

    // La Fortuna tickets today
    const lotteryToday = await pool.query(`
        SELECT
            COUNT(*) as count,
            COALESCE(SUM(price), 0) as total
        FROM lottery_tickets
        WHERE DATE(purchased_at) = CURRENT_DATE
    `);
    console.log('\nLa Fortuna (today):');
    console.log('  Tickets:', lotteryToday.rows[0].count);
    console.log('  Amount:', lotteryToday.rows[0].total, 'USDT');

    // All lottery tickets
    const allLottery = await pool.query(`
        SELECT
            COUNT(*) as count,
            COALESCE(SUM(price), 0) as total
        FROM lottery_tickets
    `);
    console.log('\nLa Fortuna (all time):');
    console.log('  Total Tickets:', allLottery.rows[0].count);
    console.log('  Total Amount:', allLottery.rows[0].total, 'USDT');

    // Combined totals
    const bolitaTotal = parseFloat(betsToday.rows[0].total) || 0;
    const lotteryTotal = parseFloat(lotteryToday.rows[0].total) || 0;

    console.log('\n=== COMBINED TODAY ===');
    console.log('Total Bets/Tickets:', parseInt(betsToday.rows[0].count) + parseInt(lotteryToday.rows[0].count));
    console.log('Total Wagered:', bolitaTotal + lotteryTotal, 'USDT');

    await pool.end();
}

testMetrics().catch(console.error);
