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
const { toCents, fromCents } = require('../utils/money');
const { calculateBetCommission } = require('./referralAdminService');

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

    // Validar monto (use integer math: round to 2 decimal places then compare)
    const numAmount = Math.round(parseFloat(amount) * 100) / 100;
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
    // Use integer cents to avoid floating-point errors
    let totalCents = 0;

    for (const bet of bets) {
        const amountCents = Math.round(parseFloat(bet.amount) * 100);

        if (bet.game_type === 'corrido') {
            totalCents += amountCents * 2;
        } else {
            totalCents += amountCents;
        }
    }

    return totalCents / 100;
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

// autoDepositForUser REMOVED — security vulnerability (custodial pattern)
// In non-custodial mode, users interact directly with the smart contract

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
        const currentBalanceCents = toCents(user.balance);

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
            const amount = fromCents(toCents(bet.amount));

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
        const totalCostCents = toCents(totalCost);

        if (currentBalanceCents < totalCostCents) {
            const currentBalance = fromCents(currentBalanceCents);
            throw new Error(`Balance insuficiente. Tienes ${currentBalance} USDT, necesitas ${totalCost} USDT`);
        }

        // 4. Debitar balance (with optimistic locking check)
        const newBalance = fromCents(currentBalanceCents - totalCostCents);

        const updateResult = await client.query(
            'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2 AND version = $3',
            [newBalance, userId, user.version]
        );

        if (updateResult.rowCount === 0) {
            throw new Error('Concurrent balance update detected. Please retry.');
        }

        // 5. Crear registros de apuestas y registrar exposición
        const createdBets = [];

        for (const bet of validatedBets) {
            const amount = bet.amount;
            const gameType = bet.game_type;
            const number = bet.formattedNumber;
            const rules = GAME_RULES[gameType];
            const potentialPayout = fromCents(toCents(amount) * rules.multiplier);

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

            // Comision de referido (fire-and-forget, no bloquea la apuesta)
            calculateBetCommission(betResult.rows[0].id, userId, amount).catch(() => {});
        }

        // NOTE: In non-custodial mode, bets go directly to the smart contract
        // from the frontend. This backend path is legacy/indexer-only.
        // No blockchain registration from backend — users call contract directly.

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
            net_profit: fromCents(toCents(stats.total_winnings || 0) - toCents(stats.total_amount || 0))
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