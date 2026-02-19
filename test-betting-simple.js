// Script simple para probar apuestas usando fetch
async function testBetting() {
    try {
        console.log('=== PRUEBA DE APUESTAS CON BLOCKCHAIN ===');

        // 1. Verificar sorteos disponibles
        console.log('\n1. Verificando sorteos disponibles...');
        const drawsResponse = await fetch('http://localhost:5000/api/draws/active');
        const drawsData = await drawsResponse.json();
        const draws = drawsData.data.draws;
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
        const walletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

        const createUserResponse = await fetch('http://localhost:5000/api/dev/give-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: walletAddress, amount: 100 })
        });
        const createData = await createUserResponse.json();
        console.log('Usuario creado:', createData);

        // 3. Hacer apuesta de prueba
        console.log('\n3. Realizando apuesta de prueba...');
        const betData = {
            drawId: testDraw.id,
            betType: 'fijos',
            numbers: '00',
            amount: 1
        };

        console.log(`Apostando: ${betData.betType} ${betData.numbers} por ${betData.amount} USDT`);

        const betResponse = await fetch('http://localhost:5000/api/dev/test-bet', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-wallet-address': walletAddress
            },
            body: JSON.stringify(betData)
        });

        const betResult = await betResponse.json();
        console.log('Respuesta de apuesta:', JSON.stringify(betResult, null, 2));

        // 4. Esperar y verificar contrato
        console.log('\n4. Esperando procesamiento...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Ejecutar check-contract usando child_process
        const { exec } = require('child_process');
        exec('cd contracts && node check-contract.js', (error, stdout, stderr) => {
            console.log('\n=== ESTADO DEL CONTRATO DESPUÉS DE APUESTA ===');
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            if (error) console.error('Error:', error.message);
        });

    } catch (error) {
        console.error('Error en prueba:', error.message);
    }
}

testBetting();