const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

// =================================
// SCRIPT PARA CARGAR DATOS DE PRUEBA
// =================================

console.log('\n=================================');
console.log('🌱 CARGAR DATOS DE PRUEBA');
console.log('=================================\n');

async function seedData() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('1️⃣  Creando usuarios de prueba...\n');

        // Crear 3 usuarios de prueba
        const users = [
            { username: 'usuario1', email: 'usuario1@test.com', password: 'password123', balance: 500 },
            { username: 'usuario2', email: 'usuario2@test.com', password: 'password123', balance: 1000 },
            { username: 'usuario3', email: 'usuario3@test.com', password: 'password123', balance: 2000 }
        ];

        const createdUsers = [];

        for (const user of users) {
            try {
                const password_hash = await bcrypt.hash(user.password, 10);

                const result = await pool.query(
                    `INSERT INTO users (username, email, password_hash, role, balance)
                     VALUES ($1, $2, $3, 'user', $4)
                     RETURNING id, username, balance`,
                    [user.username, user.email, password_hash, user.balance]
                );

                createdUsers.push(result.rows[0]);
                console.log(`   ✓ ${user.username} creado (Balance: ${user.balance} USDT)`);

            } catch (error) {
                if (error.code === '23505') {
                    console.log(`   ⚠️  ${user.username} ya existe, omitiendo...`);
                } else {
                    throw error;
                }
            }
        }

        console.log(`\n✅ ${createdUsers.length} usuarios creados\n`);

        // Crear sorteos de prueba
        console.log('2️⃣  Creando sorteos de prueba...\n');

        const now = new Date();
        const sorteos = [
            {
                draw_number: `TEST-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-1`,
                scheduled_time: new Date(now.getTime() + 2 * 60 * 60 * 1000), // +2 horas
                status: 'open'
            },
            {
                draw_number: `TEST-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-2`,
                scheduled_time: new Date(now.getTime() + 4 * 60 * 60 * 1000), // +4 horas
                status: 'scheduled'
            },
            {
                draw_number: `TEST-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-3`,
                scheduled_time: new Date(now.getTime() + 6 * 60 * 60 * 1000), // +6 horas
                status: 'scheduled'
            }
        ];

        const createdDraws = [];

        for (const sorteo of sorteos) {
            try {
                const result = await pool.query(
                    `INSERT INTO draws (draw_number, scheduled_time, status)
                     VALUES ($1, $2, $3)
                     RETURNING id, draw_number, status`,
                    [sorteo.draw_number, sorteo.scheduled_time, sorteo.status]
                );

                createdDraws.push(result.rows[0]);
                console.log(`   ✓ Sorteo ${sorteo.draw_number} (${sorteo.status})`);

            } catch (error) {
                if (error.code === '23505') {
                    console.log(`   ⚠️  Sorteo ${sorteo.draw_number} ya existe, omitiendo...`);
                } else {
                    throw error;
                }
            }
        }

        console.log(`\n✅ ${createdDraws.length} sorteos creados\n`);

        // Crear algunas apuestas de ejemplo (solo si hay usuarios y sorteos)
        if (createdUsers.length > 0 && createdDraws.length > 0) {
            console.log('3️⃣  Creando apuestas de ejemplo...\n');

            const userId = createdUsers[0].id;
            const drawId = createdDraws[0].id;

            const apuestas = [
                { game_type: 'fijos', bet_number: '23', amount: 10, multiplier: 80 },
                { game_type: 'centenas', bet_number: '234', amount: 5, multiplier: 500 },
                { game_type: 'parles', bet_number: '1234', amount: 2, multiplier: 900 }
            ];

            for (const apuesta of apuestas) {
                const potentialPayout = apuesta.amount * apuesta.multiplier;

                await pool.query(
                    `INSERT INTO bets (user_id, draw_id, game_type, bet_number, amount, potential_payout, multiplier, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
                    [userId, drawId, apuesta.game_type, apuesta.bet_number, apuesta.amount, potentialPayout, apuesta.multiplier]
                );

                console.log(`   ✓ Apuesta ${apuesta.game_type} #${apuesta.bet_number} (${apuesta.amount} USDT → ${potentialPayout} USDT)`);
            }

            console.log('\n✅ Apuestas de ejemplo creadas\n');
        }

        // Mostrar resumen
        console.log('=================================');
        console.log('📊 RESUMEN DE DATOS CARGADOS');
        console.log('=================================\n');

        const usersCount = await pool.query('SELECT COUNT(*) FROM users');
        const drawsCount = await pool.query('SELECT COUNT(*) FROM draws');
        const betsCount = await pool.query('SELECT COUNT(*) FROM bets');

        console.log(`Usuarios totales: ${usersCount.rows[0].count}`);
        console.log(`Sorteos totales: ${drawsCount.rows[0].count}`);
        console.log(`Apuestas totales: ${betsCount.rows[0].count}\n`);

        console.log('=================================');
        console.log('🔑 CREDENCIALES DE PRUEBA');
        console.log('=================================\n');

        console.log('Usuario Admin:');
        console.log('  Username: admin');
        console.log('  Password: admin123\n');

        console.log('Usuarios de Prueba:');
        users.forEach(user => {
            console.log(`  Username: ${user.username}`);
            console.log(`  Password: password123`);
            console.log(`  Balance: ${user.balance} USDT\n`);
        });

        console.log('=================================\n');

        console.log('Próximos pasos:');
        console.log('1. Iniciar servidor: npm run dev');
        console.log('2. Probar el API: node scripts/test-api.js');
        console.log('3. Login con cualquier usuario de prueba\n');

    } catch (error) {
        console.error('❌ Error cargando datos:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

seedData();
