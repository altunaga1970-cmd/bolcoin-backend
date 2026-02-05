const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function viewDatabase() {
  console.log('\n=== VERIFICACION DE BASE DE DATOS ===\n');

  try {
    // Usuarios
    const users = await pool.query('SELECT id, username, email, role, balance FROM users ORDER BY id');
    console.log('USUARIOS:');
    users.rows.forEach(u => {
      console.log(`  [${u.id}] ${u.username} (${u.role}) - Balance: ${u.balance} USDT`);
    });

    // Sorteos
    const draws = await pool.query('SELECT id, draw_number, status, bets_count, winning_fijos, winning_centenas, winning_parles FROM draws ORDER BY id');
    console.log('\nSORTEOS:');
    draws.rows.forEach(d => {
      console.log(`  [${d.id}] ${d.draw_number} - Estado: ${d.status} - Apuestas: ${d.bets_count || 0}`);
      if (d.winning_fijos) {
        console.log(`       Resultados: Fijos=${d.winning_fijos}, Centenas=${d.winning_centenas}, Parle=${d.winning_parles}`);
      }
    });

    // Apuestas
    const bets = await pool.query('SELECT id, user_id, draw_id, game_type, bet_number, amount, status FROM bets WHERE is_corrido_child = false ORDER BY id DESC LIMIT 10');
    console.log('\nAPUESTAS (ultimas 10):');
    bets.rows.forEach(b => {
      console.log(`  [${b.id}] Usuario ${b.user_id} -> Sorteo ${b.draw_id}: ${b.game_type} #${b.bet_number} x ${b.amount} USDT (${b.status})`);
    });

    // Transacciones
    const trans = await pool.query('SELECT id, user_id, transaction_type, amount, created_at FROM transactions ORDER BY id DESC LIMIT 5');
    console.log('\nTRANSACCIONES (ultimas 5):');
    trans.rows.forEach(t => {
      console.log(`  [${t.id}] Usuario ${t.user_id}: ${t.transaction_type} ${t.amount} USDT`);
    });

    console.log('\n=== SI VES DATOS, LA BASE DE DATOS FUNCIONA CORRECTAMENTE ===\n');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

viewDatabase();
