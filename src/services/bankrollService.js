const { getClient, query } = require('../config/database');
const { BOLITA_PRIZES, GAME_RULES } = require('../config/constants');

// =================================
// SERVICIO DE BANKROLL Y EXPOSICIÓN
// Sistema de gestión de límites por número
// =================================

/**
 * Obtener estado actual del bankroll
 */
async function getBankrollStatus() {
    const result = await query('SELECT * FROM bankroll_status LIMIT 1');

    if (result.rows.length === 0) {
        // Crear registro inicial si no existe
        await query(`
            INSERT INTO bankroll_status (bankroll_balance, prize_reserve, current_limit_per_number)
            VALUES (0, $1, $2)
        `, [BOLITA_PRIZES.initialReserve, BOLITA_PRIZES.numberLimits.initialLimit]);

        return {
            bankroll_balance: 0,
            prize_reserve: BOLITA_PRIZES.initialReserve,
            current_limit_per_number: BOLITA_PRIZES.numberLimits.initialLimit,
            min_limit_per_number: BOLITA_PRIZES.numberLimits.minLimit,
            max_limit_per_number: BOLITA_PRIZES.numberLimits.maxLimit
        };
    }

    return result.rows[0];
}

/**
 * Obtener límite actual por número
 */
async function getCurrentLimitPerNumber() {
    const status = await getBankrollStatus();
    return parseFloat(status.current_limit_per_number);
}

/**
 * Verificar disponibilidad de un número para apostar
 * @returns {Object} { available: boolean, availableAmount: number, message: string }
 */
async function checkNumberAvailability(drawId, gameType, betNumber, requestedAmount) {
    const client = await getClient();

    try {
        // Obtener límite actual
        const limitResult = await client.query(
            'SELECT current_limit_per_number FROM bankroll_status LIMIT 1'
        );
        const limit = parseFloat(limitResult.rows[0]?.current_limit_per_number || 2);

        // Obtener monto ya apostado a este número
        const exposureResult = await client.query(`
            SELECT COALESCE(total_amount, 0) as total_amount, is_sold_out
            FROM number_exposure
            WHERE draw_id = $1 AND game_type = $2 AND bet_number = $3
        `, [drawId, gameType, betNumber]);

        const currentAmount = Math.round(parseFloat(exposureResult.rows[0]?.total_amount || 0) * 100) / 100;
        const isSoldOut = exposureResult.rows[0]?.is_sold_out || false;

        const availableAmount = Math.round(Math.max(0, limit - currentAmount) * 100) / 100;

        if (isSoldOut || availableAmount <= 0) {
            return {
                available: false,
                availableAmount: 0,
                currentAmount,
                limit,
                message: `Número ${betNumber} vendido en su totalidad`
            };
        }

        if (requestedAmount > availableAmount) {
            return {
                available: false,
                availableAmount,
                currentAmount,
                limit,
                message: `Solo puedes apostar ${availableAmount.toFixed(2)} USDT más al número ${betNumber}`
            };
        }

        return {
            available: true,
            availableAmount,
            currentAmount,
            limit,
            message: 'OK'
        };

    } finally {
        client.release();
    }
}

/**
 * Registrar exposición de una apuesta
 * Llamar DESPUÉS de aceptar la apuesta
 */
async function registerBetExposure(client, drawId, gameType, betNumber, amount) {
    const multiplier = GAME_RULES[gameType]?.multiplier || 65;
    // Use integer cents to avoid floating-point errors
    const amountCents = Math.round(amount * 100);
    const potentialPayout = amountCents * multiplier / 100;

    // Obtener límite actual
    const limitResult = await client.query(
        'SELECT current_limit_per_number FROM bankroll_status LIMIT 1'
    );
    const limit = Math.round(parseFloat(limitResult.rows[0]?.current_limit_per_number || 2) * 100) / 100;

    // Insertar o actualizar exposición
    const result = await client.query(`
        INSERT INTO number_exposure (
            draw_id, game_type, bet_number, total_amount,
            exposure_limit, potential_payout, bets_count
        ) VALUES ($1, $2, $3, $4, $5, $6, 1)
        ON CONFLICT (draw_id, game_type, bet_number) DO UPDATE SET
            total_amount = number_exposure.total_amount + $4,
            potential_payout = number_exposure.potential_payout + $6,
            bets_count = number_exposure.bets_count + 1,
            is_sold_out = (number_exposure.total_amount + $4) >= $5,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *
    `, [drawId, gameType, betNumber, amount, limit, potentialPayout]);

    return result.rows[0];
}

/**
 * Obtener números vendidos de un sorteo
 */
async function getSoldOutNumbers(drawId) {
    const result = await query(`
        SELECT game_type, bet_number, total_amount, exposure_limit
        FROM number_exposure
        WHERE draw_id = $1 AND is_sold_out = true
        ORDER BY game_type, bet_number
    `, [drawId]);

    return result.rows;
}

/**
 * Obtener exposición total de un sorteo
 */
async function getDrawExposure(drawId) {
    const result = await query(`
        SELECT
            game_type,
            COUNT(*) as numbers_count,
            SUM(total_amount) as total_bet,
            SUM(potential_payout) as total_exposure,
            COUNT(CASE WHEN is_sold_out THEN 1 END) as sold_out_count
        FROM number_exposure
        WHERE draw_id = $1
        GROUP BY game_type
    `, [drawId]);

    const summary = {
        fijos: { numbers: 0, totalBet: 0, exposure: 0, soldOut: 0 },
        centenas: { numbers: 0, totalBet: 0, exposure: 0, soldOut: 0 },
        parles: { numbers: 0, totalBet: 0, exposure: 0, soldOut: 0 }
    };

    for (const row of result.rows) {
        if (summary[row.game_type]) {
            summary[row.game_type] = {
                numbers: parseInt(row.numbers_count),
                totalBet: parseFloat(row.total_bet),
                exposure: parseFloat(row.total_exposure),
                soldOut: parseInt(row.sold_out_count)
            };
        }
    }

    return summary;
}

/**
 * Procesar liquidación del sorteo
 * Distribuye el pool según si hay ganador o no
 */
async function settleDrawPool(drawId, winningNumbers, totalPool, prizesPaid) {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Determinar si hubo ganadores
        const hasWinner = prizesPaid > 0;

        // Seleccionar distribución según resultado
        const distribution = hasWinner
            ? BOLITA_PRIZES.distributionWithWinner
            : BOLITA_PRIZES.distributionNoWinner;

        // Calcular montos (use integer cents to avoid floating-point errors)
        const poolCents = Math.round(totalPool * 100);
        const feeAmount = Math.round(poolCents * distribution.feeBps / 10000) / 100;
        const toReserve = Math.round(poolCents * distribution.reserveBps / 10000) / 100;
        const toBankroll = Math.round(poolCents * distribution.bankrollBps / 10000) / 100;

        console.log(`\n=== Liquidación Sorteo ${drawId} ===`);
        console.log(`Pool total: ${totalPool} USDT`);
        console.log(`Hay ganador: ${hasWinner}`);
        console.log(`Premios pagados: ${prizesPaid} USDT`);
        console.log(`Fee (5%): ${feeAmount.toFixed(2)} USDT`);
        console.log(`A Reserva (${distribution.reserveBps/100}%): ${toReserve.toFixed(2)} USDT`);
        console.log(`A Bankroll (${distribution.bankrollBps/100}%): ${toBankroll.toFixed(2)} USDT`);

        // Obtener estado actual
        const statusResult = await client.query(
            'SELECT * FROM bankroll_status LIMIT 1 FOR UPDATE'
        );
        const currentStatus = statusResult.rows[0];

        const oldBankroll = Math.round(parseFloat(currentStatus.bankroll_balance) * 100) / 100;
        const oldReserve = Math.round(parseFloat(currentStatus.prize_reserve) * 100) / 100;

        // La reserva se usa para pagar premios y se repone (integer cents math)
        const newReserve = Math.round((oldReserve - prizesPaid + toReserve) * 100) / 100;
        const newBankroll = Math.round((oldBankroll + toBankroll) * 100) / 100;

        // Calcular nuevo límite
        const newLimit = calculateNewLimit(newBankroll, newReserve);

        // Actualizar bankroll_status
        await client.query(`
            UPDATE bankroll_status SET
                bankroll_balance = $1,
                prize_reserve = $2,
                current_limit_per_number = $3,
                total_bets_processed = total_bets_processed + $4,
                total_prizes_paid = total_prizes_paid + $5,
                total_fees_collected = total_fees_collected + $6,
                last_limit_update = CASE WHEN $3 != current_limit_per_number THEN NOW() ELSE last_limit_update END,
                updated_at = NOW()
        `, [newBankroll, newReserve, newLimit, totalPool, prizesPaid, feeAmount]);

        // Registrar transacciones del bankroll
        // Fee
        await client.query(`
            INSERT INTO bankroll_transactions
            (draw_id, transaction_type, amount, balance_before, balance_after, target_fund, description)
            VALUES ($1, 'fee_collection', $2, $3, $3, 'operator', $4)
        `, [drawId, feeAmount, oldBankroll, `Fee 5% del sorteo ${drawId}`]);

        // Reserva
        await client.query(`
            INSERT INTO bankroll_transactions
            (draw_id, transaction_type, amount, balance_before, balance_after, target_fund, description)
            VALUES ($1, 'prize_reserve_add', $2, $3, $4, 'reserve', $5)
        `, [drawId, toReserve, oldReserve, newReserve, `Aporte reserva sorteo ${drawId}`]);

        // Bankroll
        await client.query(`
            INSERT INTO bankroll_transactions
            (draw_id, transaction_type, amount, balance_before, balance_after, target_fund, description)
            VALUES ($1, 'bankroll_add', $2, $3, $4, 'bankroll', $5)
        `, [drawId, toBankroll, oldBankroll, newBankroll, `Aporte bankroll sorteo ${drawId}`]);

        // Si hubo pago de premios
        if (prizesPaid > 0) {
            await client.query(`
                INSERT INTO bankroll_transactions
                (draw_id, transaction_type, amount, balance_before, balance_after, target_fund, description)
                VALUES ($1, 'prize_payout', $2, $3, $4, 'reserve', $5)
            `, [drawId, -prizesPaid, oldReserve, oldReserve - prizesPaid, `Pago premios sorteo ${drawId}`]);
        }

        // Registrar liquidación completa
        await client.query(`
            INSERT INTO draw_settlement (
                draw_id, total_pool, has_winner,
                winning_fijo, winning_centena, winning_parle,
                total_prizes_paid, fee_amount, to_reserve, to_bankroll,
                new_bankroll_balance, new_reserve_balance, new_limit_per_number
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (draw_id) DO UPDATE SET
                total_pool = $2,
                has_winner = $3,
                winning_fijo = $4,
                winning_centena = $5,
                winning_parle = $6,
                total_prizes_paid = $7,
                fee_amount = $8,
                to_reserve = $9,
                to_bankroll = $10,
                new_bankroll_balance = $11,
                new_reserve_balance = $12,
                new_limit_per_number = $13,
                settled_at = NOW()
        `, [
            drawId, totalPool, hasWinner,
            winningNumbers.fijos, winningNumbers.centenas, winningNumbers.parles,
            prizesPaid, feeAmount, toReserve, toBankroll,
            newBankroll, newReserve, newLimit
        ]);

        await client.query('COMMIT');

        console.log(`\n=== Estado después de liquidación ===`);
        console.log(`Bankroll: ${oldBankroll.toFixed(2)} → ${newBankroll.toFixed(2)} USDT`);
        console.log(`Reserva: ${oldReserve.toFixed(2)} → ${newReserve.toFixed(2)} USDT`);
        console.log(`Límite por número: ${currentStatus.current_limit_per_number} → ${newLimit.toFixed(2)} USDT`);

        return {
            success: true,
            hasWinner,
            totalPool,
            prizesPaid,
            feeAmount,
            toReserve,
            toBankroll,
            newBankroll,
            newReserve,
            newLimit,
            oldLimit: parseFloat(currentStatus.current_limit_per_number)
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en liquidación del sorteo:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Calcular nuevo límite basado en bankroll y reserva
 */
function calculateNewLimit(bankroll, reserve) {
    const minLimit = BOLITA_PRIZES.numberLimits.minLimit;
    const maxLimit = BOLITA_PRIZES.numberLimits.maxLimit;

    // Fórmula:
    // 1. Base del límite desde la reserva (reserva / (multiplicador_max * factor_seguridad))
    // 2. Bonus del bankroll (bankroll / 500 = 1 USDT extra por cada 500 en bankroll)

    const baseFromReserve = reserve / 3000; // 3000 = 1000x * 3 factor seguridad
    const bonusFromBankroll = bankroll / 500;

    let newLimit = baseFromReserve + bonusFromBankroll;

    // Aplicar límites
    newLimit = Math.max(minLimit, Math.min(maxLimit, newLimit));

    // Redondear a 2 decimales
    return Math.round(newLimit * 100) / 100;
}

/**
 * Verificar si hay suficiente reserva para cubrir exposición
 */
async function canAcceptBet(drawId, gameType, betNumber, amount) {
    const client = await getClient();

    try {
        // Verificar disponibilidad del número
        const availability = await checkNumberAvailability(drawId, gameType, betNumber, amount);

        if (!availability.available) {
            return availability;
        }

        // Verificar que la reserva puede cubrir el pago potencial
        const multiplier = GAME_RULES[gameType]?.multiplier || 65;
        const potentialPayout = Math.round(amount * multiplier * 100) / 100;

        const reserveResult = await client.query(
            'SELECT prize_reserve FROM bankroll_status LIMIT 1'
        );
        const reserve = Math.round(parseFloat(reserveResult.rows[0]?.prize_reserve || 0) * 100) / 100;

        // Obtener exposición actual del sorteo
        const exposureResult = await client.query(`
            SELECT COALESCE(SUM(potential_payout), 0) as total_exposure
            FROM number_exposure
            WHERE draw_id = $1
        `, [drawId]);
        const currentExposure = Math.round(parseFloat(exposureResult.rows[0]?.total_exposure || 0) * 100) / 100;

        // La reserva debe cubrir al menos la exposición máxima de UN número ganador
        // No todos, porque solo puede haber un ganador por tipo
        if (potentialPayout > reserve) {
            return {
                available: false,
                availableAmount: 0,
                message: 'Sistema en pausa: reserva insuficiente para cubrir premios potenciales'
            };
        }

        return {
            available: true,
            availableAmount: availability.availableAmount,
            currentAmount: availability.currentAmount,
            limit: availability.limit,
            potentialPayout,
            reserve,
            message: 'OK'
        };

    } finally {
        client.release();
    }
}

/**
 * Obtener historial de liquidaciones
 */
async function getSettlementHistory(limit = 20) {
    const result = await query(`
        SELECT ds.*, d.draw_number
        FROM draw_settlement ds
        JOIN draws d ON ds.draw_id = d.id
        ORDER BY ds.settled_at DESC
        LIMIT $1
    `, [limit]);

    return result.rows;
}

/**
 * Inicializar capital inicial (solo para setup)
 */
async function initializeCapital(initialReserve) {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Verificar si ya existe
        const existing = await client.query('SELECT * FROM bankroll_status LIMIT 1');

        if (existing.rows.length > 0) {
            throw new Error('El sistema ya está inicializado');
        }

        // Crear registro inicial
        await client.query(`
            INSERT INTO bankroll_status (
                bankroll_balance, prize_reserve, current_limit_per_number,
                min_limit_per_number, max_limit_per_number
            ) VALUES (0, $1, $2, $2, $3)
        `, [initialReserve, BOLITA_PRIZES.numberLimits.initialLimit, BOLITA_PRIZES.numberLimits.maxLimit]);

        // Registrar transacción
        await client.query(`
            INSERT INTO bankroll_transactions
            (transaction_type, amount, balance_before, balance_after, target_fund, description)
            VALUES ('initial_capital', $1, 0, $1, 'reserve', 'Capital inicial del operador')
        `, [initialReserve]);

        await client.query('COMMIT');

        console.log(`Sistema inicializado con reserva de ${initialReserve} USDT`);

        return {
            success: true,
            initialReserve,
            initialLimit: BOLITA_PRIZES.numberLimits.initialLimit
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Ajustar capital manualmente (admin)
 */
async function adjustCapital(targetFund, amount, reason, adminId) {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        const statusResult = await client.query(
            'SELECT * FROM bankroll_status LIMIT 1 FOR UPDATE'
        );
        const status = statusResult.rows[0];

        let balanceBefore, balanceAfter, updateField;

        if (targetFund === 'reserve') {
            balanceBefore = Math.round(parseFloat(status.prize_reserve) * 100) / 100;
            balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;
            updateField = 'prize_reserve';
        } else if (targetFund === 'bankroll') {
            balanceBefore = Math.round(parseFloat(status.bankroll_balance) * 100) / 100;
            balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;
            updateField = 'bankroll_balance';
        } else {
            throw new Error('Fondo inválido. Use "reserve" o "bankroll"');
        }

        if (balanceAfter < 0) {
            throw new Error('El ajuste resultaría en balance negativo');
        }

        // Actualizar
        await client.query(`
            UPDATE bankroll_status SET ${updateField} = $1, updated_at = NOW()
        `, [balanceAfter]);

        // Recalcular límite si cambió la reserva
        if (targetFund === 'reserve') {
            const newLimit = calculateNewLimit(
                parseFloat(status.bankroll_balance),
                balanceAfter
            );
            await client.query(`
                UPDATE bankroll_status SET current_limit_per_number = $1
            `, [newLimit]);
        }

        // Registrar transacción
        await client.query(`
            INSERT INTO bankroll_transactions
            (transaction_type, amount, balance_before, balance_after, target_fund, description)
            VALUES ('manual_adjustment', $1, $2, $3, $4, $5)
        `, [amount, balanceBefore, balanceAfter, targetFund, reason || 'Ajuste manual']);

        await client.query('COMMIT');

        return {
            success: true,
            targetFund,
            amount,
            balanceBefore,
            balanceAfter
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    getBankrollStatus,
    getCurrentLimitPerNumber,
    checkNumberAvailability,
    registerBetExposure,
    getSoldOutNumbers,
    getDrawExposure,
    settleDrawPool,
    calculateNewLimit,
    canAcceptBet,
    getSettlementHistory,
    initializeCapital,
    adjustCapital
};
