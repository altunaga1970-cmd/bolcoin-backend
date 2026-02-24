const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { getClient } = require('../config/database');
const { TRANSACTION_TYPE, LIMITS, ERROR_MESSAGES } = require('../config/constants');

// =================================
// SERVICIO DE BILLETERA
// =================================

/**
 * Recargar balance del usuario
 */
async function recharge(userId, amount) {
    // Validar monto
    if (amount < LIMITS.MIN_RECHARGE_AMOUNT) {
        throw new Error(`El monto mínimo de recarga es ${LIMITS.MIN_RECHARGE_AMOUNT} USDT`);
    }

    if (amount > LIMITS.MAX_RECHARGE_AMOUNT) {
        throw new Error(`El monto máximo de recarga es ${LIMITS.MAX_RECHARGE_AMOUNT} USDT`);
    }

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Obtener balance actual
        const userResult = await client.query(
            'SELECT id, balance, version FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );

        if (userResult.rows.length === 0) {
            throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
        }

        const user = userResult.rows[0];
        const balanceBefore = parseFloat(user.balance);
        const balanceAfter = balanceBefore + parseFloat(amount);

        // Verificar que no exceda el balance máximo
        if (balanceAfter > LIMITS.MAX_BALANCE) {
            throw new Error(`El balance no puede exceder ${LIMITS.MAX_BALANCE} USDT`);
        }

        // Actualizar balance con verificacion de optimistic lock
        const updateResult = await client.query(
            'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2 AND version = $3',
            [balanceAfter, userId, user.version]
        );

        if (updateResult.rowCount === 0) {
            throw new Error('Conflicto de concurrencia al actualizar balance. Reintente la operacion.');
        }

        // Crear registro de transacción
        const transactionResult = await client.query(
            `INSERT INTO transactions (
                user_id, transaction_type, amount, balance_before, balance_after,
                reference_type, description
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [
                userId,
                TRANSACTION_TYPE.RECHARGE,
                amount,
                balanceBefore,
                balanceAfter,
                'recharge',
                `Recarga de ${amount} USDT`
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            balance: balanceAfter,
            transaction: transactionResult.rows[0]
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Obtener balance actual del usuario
 */
async function getBalance(userId) {
    const user = await User.findById(userId);

    if (!user) {
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Calcular el total de apuestas pendientes
    const { query } = require('../config/database');
    const pendingBetsResult = await query(
        `SELECT COALESCE(SUM(amount), 0) as pending_amount
         FROM bets
         WHERE user_id = $1 AND status = 'pending'`,
        [userId]
    );

    const pendingAmount = parseFloat(pendingBetsResult.rows[0].pending_amount || 0);

    return {
        balance: parseFloat(user.balance),
        pending_bets: pendingAmount,
        available: parseFloat(user.balance) - pendingAmount
    };
}

/**
 * Obtener historial de transacciones del usuario
 */
async function getTransactionHistory(userId, { page = 1, limit = 20, type = null }) {
    return await Transaction.findByUserId(userId, { page, limit, type });
}

/**
 * Ajustar balance manualmente (solo admin)
 */
async function adjustBalance(userId, amount, reason, adminId) {
    if (amount === 0) {
        throw new Error('El monto de ajuste no puede ser cero');
    }

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Obtener balance actual
        const userResult = await client.query(
            'SELECT id, balance, version FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );

        if (userResult.rows.length === 0) {
            throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
        }

        const user = userResult.rows[0];
        const balanceBefore = parseFloat(user.balance);
        const balanceAfter = balanceBefore + parseFloat(amount);

        // Verificar que el balance no sea negativo
        if (balanceAfter < 0) {
            throw new Error('El ajuste resultaría en un balance negativo');
        }

        // Verificar que no exceda el balance máximo
        if (balanceAfter > LIMITS.MAX_BALANCE) {
            throw new Error(`El balance no puede exceder ${LIMITS.MAX_BALANCE} USDT`);
        }

        // Actualizar balance con verificacion de optimistic lock
        const updateResult = await client.query(
            'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2 AND version = $3',
            [balanceAfter, userId, user.version]
        );

        if (updateResult.rowCount === 0) {
            throw new Error('Conflicto de concurrencia al actualizar balance. Reintente la operacion.');
        }

        // Crear registro de transacción
        const transactionResult = await client.query(
            `INSERT INTO transactions (
                user_id, transaction_type, amount, balance_before, balance_after,
                reference_type, reference_id, description
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                userId,
                TRANSACTION_TYPE.ADJUSTMENT,
                amount,
                balanceBefore,
                balanceAfter,
                'adjustment',
                adminId,
                `Ajuste manual: ${reason}`
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            balance: balanceAfter,
            transaction: transactionResult.rows[0]
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Crear transacción para apuesta
 */
async function createBetTransaction(userId, amount, balanceBefore, balanceAfter, betId) {
    return await Transaction.create({
        user_id: userId,
        transaction_type: TRANSACTION_TYPE.BET,
        amount: -Math.abs(amount),  // Negativo porque es un gasto
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reference_type: 'bet',
        reference_id: betId,
        description: `Apuesta de ${amount} USDT`
    });
}

/**
 * Crear transacción para ganancia
 */
async function createWinTransaction(userId, amount, balanceBefore, balanceAfter, betId) {
    return await Transaction.create({
        user_id: userId,
        transaction_type: TRANSACTION_TYPE.WIN,
        amount: amount,  // Positivo porque es un ingreso
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reference_type: 'bet',
        reference_id: betId,
        description: `Ganancia de ${amount} USDT`
    });
}

module.exports = {
    recharge,
    getBalance,
    getTransactionHistory,
    adjustBalance,
    createBetTransaction,
    createWinTransaction
};
