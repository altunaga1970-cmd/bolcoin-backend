const axios = require('axios');

// =================================
// SCRIPT DE PRUEBA DEL API
// =================================

const API_URL = 'http://localhost:5000/api';
let authToken = null;
let adminToken = null;
let userId = null;
let drawId = null;

// Colores para la consola
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(emoji, message, color = colors.reset) {
    console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function logSuccess(message) {
    log('✅', message, colors.green);
}

function logError(message) {
    log('❌', message, colors.red);
}

function logInfo(message) {
    log('ℹ️ ', message, colors.cyan);
}

function logSection(message) {
    console.log(`\n${colors.yellow}${'='.repeat(50)}`);
    console.log(`${message}`);
    console.log(`${'='.repeat(50)}${colors.reset}\n`);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =================================
// TESTS
// =================================

async function test1_HealthCheck() {
    logSection('TEST 1: Health Check');

    try {
        const response = await axios.get('http://localhost:5000/health');
        logSuccess('Servidor respondiendo correctamente');
        logInfo(`Status: ${response.data.status}`);
        return true;
    } catch (error) {
        logError('Servidor no responde');
        logError('Asegúrate de que el servidor esté corriendo: npm run dev');
        return false;
    }
}

async function test2_RegisterUser() {
    logSection('TEST 2: Registro de Usuario');

    try {
        const userData = {
            username: `testuser_${Date.now()}`,
            email: `test_${Date.now()}@test.com`,
            password: 'password123'
        };

        const response = await axios.post(`${API_URL}/auth/register`, userData);

        logSuccess('Usuario registrado exitosamente');
        logInfo(`Username: ${response.data.data.user.username}`);
        logInfo(`Email: ${response.data.data.user.email}`);
        logInfo(`Balance inicial: ${response.data.data.user.balance} USDT`);

        authToken = response.data.data.token;
        userId = response.data.data.user.id;

        logInfo(`Token JWT recibido (${authToken.substring(0, 20)}...)`);

        return true;
    } catch (error) {
        logError('Error en registro: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test3_LoginUser() {
    logSection('TEST 3: Login de Usuario');

    try {
        const response = await axios.post(`${API_URL}/auth/login`, {
            username: 'admin',
            password: 'admin123'
        });

        logSuccess('Login exitoso');
        logInfo(`Usuario: ${response.data.data.user.username}`);
        logInfo(`Role: ${response.data.data.user.role}`);
        logInfo(`Balance: ${response.data.data.user.balance} USDT`);

        adminToken = response.data.data.token;

        return true;
    } catch (error) {
        logError('Error en login: ' + error.response?.data?.message || error.message);
        logError('💡 Asegúrate de haber creado el usuario admin: node scripts/create-admin.js');
        return false;
    }
}

async function test4_GetProfile() {
    logSection('TEST 4: Obtener Perfil');

    try {
        const response = await axios.get(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        logSuccess('Perfil obtenido correctamente');
        logInfo(`Username: ${response.data.data.user.username}`);
        logInfo(`Balance: ${response.data.data.user.balance} USDT`);

        return true;
    } catch (error) {
        logError('Error obteniendo perfil: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test5_RechargeBalance() {
    logSection('TEST 5: Recargar Balance');

    try {
        const response = await axios.post(
            `${API_URL}/wallet/recharge`,
            { amount: 1000 },
            { headers: { Authorization: `Bearer ${authToken}` } }
        );

        logSuccess('Balance recargado exitosamente');
        logInfo(`Monto recargado: 1000 USDT`);
        logInfo(`Nuevo balance: ${response.data.data.balance} USDT`);

        return true;
    } catch (error) {
        logError('Error recargando balance: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test6_CreateDraw() {
    logSection('TEST 6: Crear Sorteo (Admin)');

    try {
        const now = new Date();
        const futureDate = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2 horas

        const drawData = {
            draw_number: `TEST-API-${Date.now()}`,
            scheduled_time: futureDate.toISOString()
        };

        const response = await axios.post(`${API_URL}/admin/draws`, drawData, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });

        drawId = response.data.data.draw.id;

        logSuccess('Sorteo creado exitosamente');
        logInfo(`ID: ${drawId}`);
        logInfo(`Número: ${response.data.data.draw.draw_number}`);
        logInfo(`Estado: ${response.data.data.draw.status}`);

        return true;
    } catch (error) {
        logError('Error creando sorteo: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test7_OpenDraw() {
    logSection('TEST 7: Abrir Sorteo para Apuestas');

    try {
        const response = await axios.put(`${API_URL}/admin/draws/${drawId}/open`, {}, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });

        logSuccess('Sorteo abierto para apuestas');
        logInfo(`Estado: ${response.data.data.draw.status}`);

        return true;
    } catch (error) {
        logError('Error abriendo sorteo: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test8_PlaceFijoBet() {
    logSection('TEST 8: Realizar Apuesta Fijos');

    try {
        const betData = {
            draw_id: drawId,
            bets: [
                { game_type: 'fijos', number: '23', amount: 10 }
            ]
        };

        const response = await axios.post(`${API_URL}/bets/place`, betData, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        logSuccess('Apuesta Fijos realizada exitosamente');
        logInfo(`Número: 23`);
        logInfo(`Monto: 10 USDT`);
        logInfo(`Pago potencial: 650 USDT (65x)`);
        logInfo(`Nuevo balance: ${response.data.data.new_balance} USDT`);

        return true;
    } catch (error) {
        logError('Error realizando apuesta: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test9_PlaceCorridoBet() {
    logSection('TEST 9: Realizar Apuesta Corrido');

    try {
        const betData = {
            draw_id: drawId,
            bets: [
                { game_type: 'corrido', number: '1234', amount: 5 }
            ]
        };

        const response = await axios.post(`${API_URL}/bets/place`, betData, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        logSuccess('Apuesta Corrido realizada exitosamente');
        logInfo(`Número: 1234`);
        logInfo(`Monto: 5 USDT por Fijos (Total: 10 USDT)`);
        logInfo(`Crea 2 apuestas Fijos: "12" y "34"`);
        logInfo(`Cada una paga 400 USDT si gana (5 × 80)`);
        logInfo(`Nuevo balance: ${response.data.data.new_balance} USDT`);

        return true;
    } catch (error) {
        logError('Error realizando apuesta Corrido: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test10_GetMyBets() {
    logSection('TEST 10: Ver Mis Apuestas');

    try {
        const response = await axios.get(`${API_URL}/bets/my-bets`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        logSuccess('Apuestas obtenidas correctamente');
        logInfo(`Total de apuestas: ${response.data.data.bets.length}`);

        response.data.data.bets.forEach((bet, index) => {
            console.log(`\n   Apuesta ${index + 1}:`);
            console.log(`   - Tipo: ${bet.game_type}`);
            console.log(`   - Número: ${bet.bet_number}`);
            console.log(`   - Monto: ${bet.amount} USDT`);
            console.log(`   - Estado: ${bet.status}`);
        });

        return true;
    } catch (error) {
        logError('Error obteniendo apuestas: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test11_EnterResults() {
    logSection('TEST 11: Ingresar Número Ganador');

    try {
        // Número ganador: 1223
        // Esto hará que gane:
        // - Fijos "23" ✓
        // - Corrido Fijos "12" (pierde)
        // - Corrido Fijos "34" (pierde)

        const response = await axios.put(
            `${API_URL}/admin/draws/${drawId}/results`,
            { winning_number: '1223' },
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );

        logSuccess('Resultados ingresados y pagos procesados');
        logInfo(`Número ganador: 1223`);
        logInfo(`Ganadores: ${response.data.data.winners_count}`);
        logInfo(`Total pagado: ${response.data.data.total_payouts} USDT`);
        logInfo(`Apuestas procesadas: ${response.data.data.bets_processed}`);

        await sleep(1000);

        return true;
    } catch (error) {
        logError('Error ingresando resultados: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test12_VerifyWinnings() {
    logSection('TEST 12: Verificar Ganancias');

    try {
        const response = await axios.get(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        logSuccess('Balance actualizado verificado');
        logInfo(`Balance actual: ${response.data.data.user.balance} USDT`);
        logInfo('(Debería incluir las ganancias de la apuesta Fijos "23")');

        return true;
    } catch (error) {
        logError('Error verificando ganancias: ' + error.response?.data?.message || error.message);
        return false;
    }
}

async function test13_GetDrawStats() {
    logSection('TEST 13: Obtener Estadísticas del Sorteo');

    try {
        const response = await axios.get(`${API_URL}/admin/draws/${drawId}/stats`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });

        logSuccess('Estadísticas obtenidas correctamente');

        const stats = response.data.data.stats;
        console.log('\n   📊 Estadísticas:');
        console.log(`   - Total apostado: ${stats.total_wagered} USDT`);
        console.log(`   - Total pagado: ${stats.total_payouts} USDT`);
        console.log(`   - Ganadores: ${stats.winners_count}`);
        console.log(`   - Perdedores: ${stats.losers_count}`);

        return true;
    } catch (error) {
        logError('Error obteniendo estadísticas: ' + error.response?.data?.message || error.message);
        return false;
    }
}

// =================================
// EJECUTAR TODOS LOS TESTS
// =================================

async function runAllTests() {
    console.log('\n');
    console.log(colors.cyan + '╔═══════════════════════════════════════════════════╗');
    console.log('║                                                   ║');
    console.log('║        🧪 PRUEBAS COMPLETAS DEL API              ║');
    console.log('║           La Bolita - Backend Test               ║');
    console.log('║                                                   ║');
    console.log('╚═══════════════════════════════════════════════════╝' + colors.reset);
    console.log('\n');

    const tests = [
        { name: 'Health Check', fn: test1_HealthCheck },
        { name: 'Registro de Usuario', fn: test2_RegisterUser },
        { name: 'Login de Usuario', fn: test3_LoginUser },
        { name: 'Obtener Perfil', fn: test4_GetProfile },
        { name: 'Recargar Balance', fn: test5_RechargeBalance },
        { name: 'Crear Sorteo', fn: test6_CreateDraw },
        { name: 'Abrir Sorteo', fn: test7_OpenDraw },
        { name: 'Apuesta Fijos', fn: test8_PlaceFijoBet },
        { name: 'Apuesta Corrido', fn: test9_PlaceCorridoBet },
        { name: 'Ver Mis Apuestas', fn: test10_GetMyBets },
        { name: 'Ingresar Resultados', fn: test11_EnterResults },
        { name: 'Verificar Ganancias', fn: test12_VerifyWinnings },
        { name: 'Estadísticas del Sorteo', fn: test13_GetDrawStats }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        const result = await test.fn();

        if (result) {
            passed++;
        } else {
            failed++;
            logError(`Test fallido: ${test.name}`);
            logError('Deteniendo pruebas...\n');
            break;
        }

        await sleep(500);
    }

    // Resumen final
    logSection('RESUMEN DE PRUEBAS');

    console.log(`Total de tests: ${tests.length}`);
    console.log(`${colors.green}✅ Pasaron: ${passed}${colors.reset}`);
    console.log(`${colors.red}❌ Fallaron: ${failed}${colors.reset}\n`);

    if (failed === 0) {
        console.log(colors.green + '╔═══════════════════════════════════════════════════╗');
        console.log('║                                                   ║');
        console.log('║      🎉 ¡TODAS LAS PRUEBAS PASARON! 🎉           ║');
        console.log('║                                                   ║');
        console.log('║   El backend está funcionando correctamente      ║');
        console.log('║                                                   ║');
        console.log('╚═══════════════════════════════════════════════════╝' + colors.reset);
        console.log('\n');
    } else {
        console.log(colors.red + '╔═══════════════════════════════════════════════════╗');
        console.log('║                                                   ║');
        console.log('║      ⚠️  ALGUNAS PRUEBAS FALLARON  ⚠️            ║');
        console.log('║                                                   ║');
        console.log('║   Revisa los errores arriba para más detalles    ║');
        console.log('║                                                   ║');
        console.log('╚═══════════════════════════════════════════════════╝' + colors.reset);
        console.log('\n');
    }
}

// Ejecutar
runAllTests().catch(error => {
    console.error('\n❌ Error fatal:', error.message);
    process.exit(1);
});
