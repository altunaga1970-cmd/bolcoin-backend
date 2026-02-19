// Script para probar apuestas con blockchain
const axios = require('axios');

async function testBetting() {
    try {
        console.log('=== PRUEBA DE APUESTAS CON BLOCKCHAIN ===');

        // 1. Verificar sorteos disponibles
        console.log('\n1. Verificando sorteos disponibles...');
        const drawsResponse = await axios.get('http://localhost:5000/api/draws/active');
        const draws = drawsResponse.data.data.draws;
        console.log(`Encontrados ${draws.length} sorteos activos`);

        if (draws.length === 0) {
            console.log('No hay sorteos disponibles para la prueba');
            return;
        }

        // Usar el primer sorteo disponible
        const testDraw = draws[0];
        console.log(`Usando sorteo: ${testDraw.draw_number} (ID: ${testDraw.id})`);

        // 2. Crear un usuario de prueba con wallet
        console.log('\n2. Creando usuario de prueba...');
        const walletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Primera cuenta de Hardhat

        const createUserResponse = await axios.post('http://localhost:5000/api/dev/give-balance', {
            address: walletAddress,
            amount: 100
        });
        console.log('Usuario creado con balance:', createUserResponse.data);

        // 3. Hacer apuesta de prueba
        console.log('\n3. Realizando apuesta de prueba...');
        const betData = {
            drawId: testDraw.id,
            betType: 'fijos',
            numbers: '00',
            amount: 1
        };

        console.log(`Apostando: ${betData.betType} ${betData.numbers} por ${betData.amount} USDT en sorteo ${betData.drawId}`);

        const betResponse = await axios.post('http://localhost:5000/api/dev/test-bet', betData, {
            headers: {
                'x-wallet-address': walletAddress
            }
        });

        console.log('Respuesta de apuesta:', betResponse.data);

        // 4. Verificar estado del contrato después de la apuesta
        console.log('\n4. Verificando contrato después de la apuesta...');

        // Pequeña pausa para que se procese
        await new Promise(resolve => setTimeout(resolve, 2000));

        const { exec } = require('child_process');
        exec('cd contracts && node check-contract.js', (error, stdout, stderr) => {
            if (error) {
                console.error('Error ejecutando check-contract:', error);
                return;
            }
            console.log('\n=== ESTADO DEL CONTRATO DESPUÉS DE APUESTA ===');
            console.log(stdout);
        });

    } catch (error) {
        console.error('Error en prueba de apuestas:', error.response?.data || error.message);
    }
}

testBetting();