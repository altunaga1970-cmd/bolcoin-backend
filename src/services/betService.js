const User = require('../models/User');
const Draw = require('../models/Draw');
const { getClient } = require('../config/database');
const {
    GAME_RULES,
    BET_STATUS,
    ERROR_MESSAGES,
    LIMITS,
    RISK_CONFIG,
    isValidNumber,
    formatNumber,
    getGameTypeFromNumber,
    validateNumberForGameType,
    formatBetNumber: formatBetNum
} = require('../config/constants');
const bankrollService = require('./bankrollService');

// Configuración de ethers para contratos
const ethers = require('ethers');
const { getLaBolitaContract } = require('../chain/provider');

// =================================
// SERVICIO DE APUESTAS
// =================================

/**
 * Validar una apuesta individual
 * Los números determinan el tipo de juego:
 * - Fijos: 00-99 (100 números)
 * - Centenas: 100-999 (900 números)
 * - Parles: 1000-9999 (9000 números)
 */
function validateBet(bet) {
    const { game_type, number, amount } = bet;

    // Validar tipo de juego
    if (!GAME_RULES[game_type]) {
        throw new Error(`Tipo de juego inválido: ${game_type}`);
    }

    const rules = GAME_RULES[game_type];

    // Validar número
    if (number === undefined || number === null || number === '') {
        throw new Error('Número de apuesta requerido');
    }

    // Validar que sea numérico
    const numberStr = String(number);
    if (!/^\d+$/.test(numberStr)) {
        throw new Error('El número debe contener solo dígitos');
    }

    const numValue = parseInt(numberStr, 10);

    // Validar que el número esté en el rango correcto para el tipo de juego
    if (numValue < rules.min || numValue > rules.max) {
        throw new Error(
            `${rules.name}: el número debe estar entre ${rules.min} y ${rules.max}. ` +
            `Recibido: ${numValue}`
        );
    }

    // Verificar que el tipo de juego coincide con el número
    const expectedType = getGameTypeFromNumber(numValue);
    if (expectedType !== game_type && game_type !== 'corrido') {
        throw new Error(
            `El número ${numValue} corresponde a ${expectedType}, no a ${game_type}`
        );
    }

    // Validar monto
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('Monto de apuesta inválido');
    }

    if (numAmount < LIMITS.MIN_BET_AMOUNT) {
        throw new Error(`Monto mínimo: ${LIMITS.MIN_BET_AMOUNT} USDT`);
    }

    if (numAmount > LIMITS.MAX_BET_AMOUNT) {
        throw new Error(`Monto máximo: ${LIMITS.MAX_BET_AMOUNT} USDT`);
    }
}

/**
 * Calcular costo total de apuestas
 */
function calculateTotalCost(bets) {
    let total = 0;

    for (const bet of bets) {
        const amount = parseFloat(bet.amount);

        if (bet.game_type === 'corrido') {
            // Corrido cuesta 2x (dos apuestas Fijos)
            total += amount * 2;
        } else {
            total += amount;
        }
    }

    return total;
}

/**
 * Formatear número de apuesta
 */
function formatBetNumber(gameType, number) {
    const rules = GAME_RULES[gameType];
    return number.padStart(rules.digits, '0');
}

/**
 * Obtener dirección de wallet del usuario
 */
async function getUserWalletAddress(userId) {
    try {
        const client = await getClient();
        const result = await client.query('SELECT wallet_address FROM users WHERE id = $1', [userId]);
        client.release();

        return result.rows[0]?.wallet_address;
    } catch (error) {
        console.error('[BetService] Error getting wallet address:', error.message);
        return null;
    }
}

/**
 * Depositar automáticamente tokens al contrato para un usuario (solo desarrollo)
 */
async function autoDepositForUser(walletAddress, amount) {
    try {
        console.log(`[Deposit] Starting auto-deposit for ${walletAddress}, amount: ${amount} USDT`);

        const contractInstance = getLaBolitaContract();
        console.log(`[Deposit] Contract instance ready`);

        // Verificar balance actual del usuario en el contrato
        const currentBalance = await contractInstance.userBalances(walletAddress);
        console.log(`[Deposit] Current contract balance: ${ethers.formatUnits(currentBalance, 6)} USDT`);

        // Usar la función adminDeposit del contrato
        const amountInWei = ethers.parseUnits(amount.toString(), 6); // USDT tiene 6 decimales
        console.log(`[Deposit] Amount in wei: ${amountInWei}`);

        console.log(`[Deposit] Calling adminDeposit(${walletAddress}, ${amountInWei})`);

        // Estimar gas primero
        try {
            const gasEstimate = await contractInstance.adminDeposit.estimateGas(walletAddress, amountInWei);
            console.log(`[Deposit] Gas estimate: ${gasEstimate}`);
        } catch (gasError) {
            console.error(`[Deposit] Gas estimation failed:`, gasError.message);
            return false;
        }

        const tx = await contractInstance.adminDeposit(walletAddress, amountInWei);
        console.log(`[Deposit] Transaction sent: ${tx.hash}`);
        console.log(`[Deposit] Transaction details:`, {
            to: tx.to,
            value: tx.value,
            gasLimit: tx.gasLimit,
            gasPrice: tx.gasPrice
        });

        console.log(`[Deposit] Waiting for confirmation...`);
        const receipt = await tx.wait();
        console.log(`[Deposit] Transaction confirmed!`);
        console.log(`[Deposit] Block: ${receipt.blockNumber}`);
        console.log(`[Deposit] Gas used: ${receipt.gasUsed}`);
        console.log(`[Deposit] Status: ${receipt.status}`);

        // Verificar nuevo balance
        const newBalance = await contractInstance.userBalances(walletAddress);
        console.log(`[Deposit] New contract balance: ${ethers.formatUnits(newBalance, 6)} USDT`);

        const expectedBalance = ethers.parseUnits((parseFloat(ethers.formatUnits(currentBalance, 6)) + parseFloat(amount)).toString(), 6);
        if (newBalance >= expectedBalance) {
            console.log(`[Deposit] Balance verification: ✓`);
            return true;
        } else {
            console.error(`[Deposit] Balance verification failed. Expected: ${ethers.formatUnits(expectedBalance, 6)}, Got: ${ethers.formatUnits(newBalance, 6)}`);
            return false;
        }

    } catch (error) {
        console.error('[Deposit] Auto-deposit failed:', error.message);
        console.error('[Deposit] Error stack:', error.stack);

        // Más detalles del error
        if (error.code) console.error('[Deposit] Error code:', error.code);
        if (error.reason) console.error('[Deposit] Error reason:', error.reason);
        if (error.transaction) console.error('[Deposit] Transaction data:', error.transaction);

        return false;
    }
}

/**
 * Realizar apuestas (con sistema de límites por número)
 */
async function placeBets(userId, drawId, bets) {
    // Validar entrada básica
    if (!bets || bets.length === 0) {
        throw new Error('Debe proporcionar al menos una apuesta');
    }

    if (bets.length > LIMITS.MAX_BETS_PER_REQUEST) {
        throw new Error(`Máximo ${LIMITS.MAX_BETS_PER_REQUEST} apuestas por solicitud`);
    }

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // 1. Obtener y validar usuario
        const userResult = await client.query(
            'SELECT id, balance, version FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );

        if (userResult.rows.length === 0) {
            throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
        }

        const user = userResult.rows[0];
        const currentBalance = parseFloat(user.balance);

        // 2. Obtener y validar sorteo
        const drawResult = await client.query(
            'SELECT id, status, scheduled_time FROM draws WHERE id = $1',
            [drawId]
        );

        if (drawResult.rows.length === 0) {
            throw new Error(ERROR_MESSAGES.DRAW_NOT_FOUND);
        }

        const draw = drawResult.rows[0];

        if (draw.status !== 'open') {
            throw new Error('El sorteo no está abierto para apuestas');
        }

        // 3. Validar cada apuesta y verificar límites por número
        const validatedBets = [];
        for (const bet of bets) {
            validateBet(bet);

            const gameType = bet.game_type;
            const number = formatBetNumber(gameType, bet.number);
            const amount = parseFloat(bet.amount);

            // Verificar disponibilidad del número (nuevo sistema)
            if (gameType !== 'corrido') {
                const availability = await bankrollService.canAcceptBet(drawId, gameType, number, amount);

                if (!availability.available) {
                    throw new Error(availability.message);
                }
            }

            validatedBets.push({ ...bet, formattedNumber: number, amount });
        }

        const totalCost = calculateTotalCost(bets);

        if (currentBalance < totalCost) {
            throw new Error(`Balance insuficiente. Tienes ${currentBalance} USDT, necesitas ${totalCost} USDT`);
        }

        // 4. Debitar balance
        const newBalance = currentBalance - totalCost;

        await client.query(
            'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2 AND version = $3',
            [newBalance, userId, user.version]
        );

        // 5. Crear registros de apuestas y registrar exposición
        const createdBets = [];

        for (const bet of validatedBets) {
            const amount = bet.amount;
            const gameType = bet.game_type;
            const number = bet.formattedNumber;
            const rules = GAME_RULES[gameType];
            const potentialPayout = amount * rules.multiplier;

            const betResult = await client.query(
                `INSERT INTO bets (
                    user_id, draw_id, game_type, bet_number, amount,
                    potential_payout, multiplier, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [
                    userId,
                    drawId,
                    gameType,
                    number,
                    amount,
                    potentialPayout,
                    rules.multiplier,
                    BET_STATUS.PENDING
                ]
            );

            // Registrar exposición del número (nuevo sistema)
            if (gameType !== 'corrido') {
                await bankrollService.registerBetExposure(client, drawId, gameType, number, amount);
            }

            createdBets.push(betResult.rows[0]);
        }

        // 6. Registrar apuestas en blockchain
        try {
            console.log(`[BetService] ===== STARTING BLOCKCHAIN REGISTRATION =====`);
            console.log(`[BetService] Bets to register: ${createdBets.length}`);
            console.log(`[BetService] Total cost: ${totalCost} USDT`);

            // getLaBolitaContract() lanza error si falta CONTRACT_ADDRESS o RPC_URL
            const contractInstance = getLaBolitaContract();
            console.log(`[BetService] Contract instance created successfully`);

            // Verificar conexión básica al contrato
            try {
                const betCounter = await contractInstance.betCounter();
                console.log(`[BetService] Contract betCounter: ${betCounter}`);
            } catch (counterError) {
                console.error(`[BetService] Error reading betCounter:`, counterError.message);
                throw new Error(`Cannot connect to contract: ${counterError.message}`);
            }

            // Obtener wallet del usuario
            console.log(`[BetService] Getting wallet address for user ${userId}`);
            const userWalletAddress = await getUserWalletAddress(userId);
            console.log(`[BetService] Wallet address result: ${userWalletAddress}`);

            if (!userWalletAddress) {
                console.error(`[BetService] No wallet address found for user ${userId}`);
                throw new Error('User wallet address not found');
            }

            console.log(`[BetService] User wallet address: ${userWalletAddress}`);

            // Verificar que la dirección sea válida
            if (!ethers.isAddress(userWalletAddress)) {
                throw new Error(`Invalid wallet address: ${userWalletAddress}`);
            }

            // Verificar balance actual en contrato
            console.log(`[BetService] Checking contract balance for ${userWalletAddress}`);
            const currentContractBalance = await contractInstance.userBalances(userWalletAddress);
            const balanceInUSDT = ethers.formatUnits(currentContractBalance, 6);
            console.log(`[BetService] Current contract balance: ${balanceInUSDT} USDT`);

            const requiredBalance = ethers.parseUnits(totalCost.toString(), 6);
            console.log(`[BetService] Required balance: ${ethers.formatUnits(requiredBalance, 6)} USDT`);

            // Si no tiene suficiente balance en contrato, depositar automáticamente
            if (currentContractBalance < requiredBalance) {
                console.log(`[BetService] Balance insufficient, depositing ${totalCost} USDT to contract`);
                const depositResult = await autoDepositForUser(userWalletAddress, totalCost);
                if (!depositResult) {
                    throw new Error('Failed to deposit funds to contract');
                }
                console.log(`[BetService] Deposit completed successfully`);
            } else {
                console.log(`[BetService] User has sufficient balance in contract (${balanceInUSDT} >= ${totalCost})`);
            }

            // Registrar cada apuesta en el contrato
            let totalGasUsed = 0;
            let betIds = [];

            for (const bet of createdBets) {
                // Mapear game_type al enum del contrato
                const betTypeMap = {
                    'fijos': 0,    // BetType.FIJO
                    'centenas': 1, // BetType.CENTENA
                    'parles': 2    // BetType.PARLE
                };

                const betType = betTypeMap[bet.game_type];
                if (betType !== undefined) {
                    const amountInWei = ethers.parseUnits(bet.amount.toString(), 6);

                    console.log(`[BetService] Submitting bet: ${bet.game_type} ${bet.bet_number} for ${bet.amount} USDT`);

                    const tx = await contractInstance.placeBet(drawId, betType, bet.bet_number, amountInWei);
                    console.log(`[BetService] Bet tx sent: ${tx.hash}`);

                    const receipt = await tx.wait();
                    console.log(`[BetService] Bet confirmed in block ${receipt.blockNumber}, gas used: ${receipt.gasUsed}`);

                    totalGasUsed += receipt.gasUsed;

                    // Extraer betId del evento BetPlaced
                    const betPlacedEvent = receipt.logs.find(log => {
                        try {
                            return contractInstance.interface.parseLog(log).name === 'BetPlaced';
                        } catch {
                            return false;
                        }
                    });

                    if (betPlacedEvent) {
                        const parsedEvent = contractInstance.interface.parseLog(betPlacedEvent);
                        const betId = parsedEvent.args[0];
                        betIds.push(betId);
                        console.log(`[BetService] Bet registered with ID: ${betId}`);
                    } else {
                        console.warn(`[BetService] BetPlaced event not found in tx ${tx.hash}`);
                    }

                } else {
                    console.log(`[BetService] Skipping bet with unknown game_type: ${bet.game_type}`);
                }
            }

            console.log(`[BetService] All ${createdBets.length} bets registered successfully. Total gas used: ${totalGasUsed}, Bet IDs: ${betIds.join(', ')}`);

        } catch (contractError) {
            console.error('[BetService] Blockchain registration failed:', contractError.message);
            console.error('[BetService] Full error details:', contractError);
            // En desarrollo, continuar sin blockchain por ahora
            console.log('[BetService] Continuing without blockchain registration for development');
        }

        await client.query('COMMIT');

        return {
            success: true,
            bets: createdBets,
            new_balance: newBalance,
            total_cost: totalCost
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Obtener apuestas de un usuario
 */
async function getUserBets(userId, filters = {}) {
    const client = await getClient();

    try {
        let query = `
            SELECT
                b.*,
                d.draw_number,
                d.scheduled_time,
                d.status as draw_status
            FROM bets b
            JOIN draws d ON b.draw_id = d.id
            WHERE b.user_id = $1
        `;
        const params = [userId];
        let paramIndex = 2;

        // Filtros
        if (filters.status) {
            query += ` AND b.status = $${paramIndex}`;
            params.push(filters.status);
            paramIndex++;
        }

        if (filters.drawId) {
            query += ` AND b.draw_id = $${paramIndex}`;
            params.push(filters.drawId);
            paramIndex++;
        }

        // Ordenar y paginar
        query += ` ORDER BY b.created_at DESC`;

        if (filters.limit) {
            query += ` LIMIT $${paramIndex}`;
            params.push(filters.limit);
            paramIndex++;
        }

        if (filters.page && filters.limit) {
            const offset = (filters.page - 1) * filters.limit;
            query += ` OFFSET $${paramIndex}`;
            params.push(offset);
        }

        const result = await client.query(query, params);

        // Obtener total para paginación
        const countQuery = `
            SELECT COUNT(*) as total
            FROM bets b
            WHERE b.user_id = $1
            ${filters.status ? 'AND b.status = $2' : ''}
            ${filters.drawId ? `AND b.draw_id = $${filters.status ? 3 : 2}` : ''}
        `;

        const countParams = [userId];
        if (filters.status) countParams.push(filters.status);
        if (filters.drawId) countParams.push(filters.drawId);

        const countResult = await client.query(countQuery, countParams);

        return {
            bets: result.rows,
            total: parseInt(countResult.rows[0].total),
            page: filters.page || 1,
            limit: filters.limit || 20
        };

    } finally {
        client.release();
    }
}

/**
 * Obtener estadísticas de apuestas del usuario
 */
async function getUserBetStats(userId) {
    const client = await getClient();

    try {
        const query = `
            SELECT
                COUNT(*) as total_bets,
                SUM(amount) as total_amount,
                SUM(CASE WHEN status = 'won' THEN payout_amount ELSE 0 END) as total_winnings,
                AVG(amount) as avg_bet_amount,
                MAX(created_at) as last_bet_date
            FROM bets
            WHERE user_id = $1
        `;

        const result = await client.query(query, [userId]);
        const stats = result.rows[0];

        return {
            total_bets: parseInt(stats.total_bets) || 0,
            total_amount: parseFloat(stats.total_amount) || 0,
            total_winnings: parseFloat(stats.total_winnings) || 0,
            avg_bet_amount: parseFloat(stats.avg_bet_amount) || 0,
            last_bet_date: stats.last_bet_date,
            net_profit: (parseFloat(stats.total_winnings) || 0) - (parseFloat(stats.total_amount) || 0)
        };

    } finally {
        client.release();
    }
}

/**
 * Obtener apuesta específica por ID
 */
async function getBetById(betId, userId = null) {
    const client = await getClient();

    try {
        let query = `
            SELECT
                b.*,
                d.draw_number,
                d.scheduled_time,
                d.status as draw_status
            FROM bets b
            JOIN draws d ON b.draw_id = d.id
            WHERE b.id = $1
        `;
        const params = [betId];

        if (userId) {
            query += ` AND b.user_id = $2`;
            params.push(userId);
        }

        const result = await client.query(query, params);

        if (result.rows.length === 0) {
            throw new Error('Apuesta no encontrada');
        }

        return result.rows[0];

    } finally {
        client.release();
    }
}

module.exports = {
    validateBet,
    calculateTotalCost,
    placeBets,
    getUserBets,
    getUserBetStats,
    getBetById
};