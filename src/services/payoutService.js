const Bet = require('../models/Bet');
const User = require('../models/User');
const Draw = require('../models/Draw');
const { getClient } = require('../config/database');
const { createWinTransaction } = require('./walletService');
const bankrollService = require('./bankrollService');

// =================================
// SERVICIO DE PAGOS
// =================================

/**
 * Procesar resultados del sorteo y distribuir pagos
 * @param {number} drawId - ID del sorteo
 * @param {object} winningNumbers - { fijos: "XX", centenas: "XXX", parles: "XXXX" }
 */
async function processDrawResults(drawId, winningNumbers) {
    console.log(`\n=== Procesando resultados del sorteo ${drawId} ===`);
    console.log(`Numeros ganadores:`, winningNumbers);

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // 1. Verificar que el sorteo existe
        const drawResult = await client.query(
            'SELECT * FROM draws WHERE id = $1 FOR UPDATE',
            [drawId]
        );

        if (drawResult.rows.length === 0) {
            throw new Error('Sorteo no encontrado');
        }

        const draw = drawResult.rows[0];

        // Verificar que el sorteo no esté ya procesado
        if (draw.status === 'completed') {
            throw new Error('El sorteo ya fue procesado');
        }

        // 2. Usar los números ganadores directamente
        const winners = {
            fijos: winningNumbers.fijos,
            centenas: winningNumbers.centenas,
            parles: winningNumbers.parles
        };
        console.log('Numeros ganadores:', winners);

        // 3. Obtener todas las apuestas pendientes del sorteo (incluyendo hijas de Corrido)
        const betsResult = await client.query(
            `SELECT * FROM bets
             WHERE draw_id = $1 AND status = 'pending'
             ORDER BY created_at ASC`,
            [drawId]
        );

        const allBets = betsResult.rows;
        console.log(`Total de apuestas a procesar: ${allBets.length}`);

        let winnersCount = 0;
        let totalPayouts = 0;

        // 4. Procesar cada apuesta
        for (const bet of allBets) {
            let isWinner = false;

            // Determinar si la apuesta es ganadora
            switch (bet.game_type) {
                case 'fijos':
                    // Gana si coinciden los últimos 2 dígitos
                    isWinner = bet.bet_number === winners.fijos;
                    break;

                case 'centenas':
                    // Gana si coinciden los últimos 3 dígitos
                    isWinner = bet.bet_number === winners.centenas;
                    break;

                case 'parles':
                    // Gana si coinciden los 4 dígitos exactos
                    isWinner = bet.bet_number === winners.parles;
                    break;

                case 'corrido':
                    // Las apuestas corrido padre no se procesan directamente
                    // Sus hijas (Fijos) se procesan individualmente
                    continue;
            }

            if (isWinner) {
                // Calcular pago
                const payout = parseFloat(bet.amount) * parseInt(bet.multiplier);

                console.log(`✓ Ganador encontrado: Apuesta #${bet.id}, Usuario #${bet.user_id}, Pago: ${payout} USDT`);

                // Actualizar estado de la apuesta
                await client.query(
                    `UPDATE bets
                     SET status = 'won', actual_payout = $1, processed_at = NOW()
                     WHERE id = $2`,
                    [payout, bet.id]
                );

                // Acreditar balance al usuario
                const userResult = await client.query(
                    'SELECT id, balance, version FROM users WHERE id = $1 FOR UPDATE',
                    [bet.user_id]
                );

                if (userResult.rows.length > 0) {
                    const user = userResult.rows[0];
                    const balanceBefore = parseFloat(user.balance);
                    const balanceAfter = balanceBefore + payout;

                    await client.query(
                        'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2 AND version = $3',
                        [balanceAfter, bet.user_id, user.version]
                    );

                    // Crear transacción de ganancia
                    await client.query(
                        `INSERT INTO transactions (
                            user_id, transaction_type, amount, balance_before, balance_after,
                            reference_type, reference_id, description
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [
                            bet.user_id,
                            'win',
                            payout,
                            balanceBefore,
                            balanceAfter,
                            'bet',
                            bet.id,
                            `Ganancia de ${bet.game_type} en sorteo ${draw.draw_number}`
                        ]
                    );

                    winnersCount++;
                    totalPayouts += payout;
                }

            } else {
                // Marcar como perdida
                await client.query(
                    `UPDATE bets
                     SET status = 'lost', processed_at = NOW()
                     WHERE id = $1`,
                    [bet.id]
                );
            }
        }

        // 5. Actualizar estadísticas del sorteo
        const statsResult = await client.query(
            `SELECT
                COUNT(*) as total_bets,
                COALESCE(SUM(amount), 0) as total_amount
             FROM bets
             WHERE draw_id = $1 AND is_corrido_child = false`,
            [drawId]
        );

        const stats = statsResult.rows[0];
        const totalPool = parseFloat(stats.total_amount);

        await client.query(
            `UPDATE draws
             SET status = 'completed',
                 winning_number = $1,
                 winning_fijos = $2,
                 winning_centenas = $3,
                 winning_parles = $4,
                 total_bets_amount = $5,
                 total_payouts_amount = $6,
                 bets_count = $7,
                 winners_count = $8
             WHERE id = $9`,
            [
                winningNumbers.parles,
                winningNumbers.fijos,
                winningNumbers.centenas,
                winningNumbers.parles,
                stats.total_amount,
                totalPayouts,
                stats.total_bets,
                winnersCount,
                drawId
            ]
        );

        await client.query('COMMIT');

        // 6. Liquidar pool y distribuir según nuevo sistema
        // 5% fee, 65% reserva (con ganador) o 45% (sin), 30% bankroll (con) o 50% (sin)
        let settlementResult = null;
        try {
            settlementResult = await bankrollService.settleDrawPool(
                drawId,
                winningNumbers,
                totalPool,
                totalPayouts
            );
            console.log(`Liquidación completada:`, settlementResult);
        } catch (settlementError) {
            console.error('Error en liquidación del pool:', settlementError);
            // Continuar aunque falle la liquidación (los premios ya se pagaron)
        }

        console.log(`\n=== Procesamiento completado ===`);
        console.log(`Ganadores: ${winnersCount}`);
        console.log(`Total pagos: ${totalPayouts} USDT`);
        console.log(`Pool total: ${totalPool} USDT`);
        console.log(`Apuestas procesadas: ${allBets.length}`);

        return {
            success: true,
            winners_count: winnersCount,
            total_payouts: totalPayouts,
            total_wagered: totalPool,
            bets_processed: allBets.length,
            settlement: settlementResult
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error procesando resultados:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Validar numeros ganadores
 * @param {object} winningNumbers - { fijos: "XX", centenas: "XXX", parles: "XXXX" }
 */
function validateWinningNumbers(winningNumbers) {
    if (!winningNumbers || typeof winningNumbers !== 'object') {
        throw new Error('Debe proporcionar los 3 numeros ganadores');
    }

    const { fijos, centenas, parles } = winningNumbers;

    // Validar fijos (2 digitos)
    if (!fijos || !/^\d{2}$/.test(fijos)) {
        throw new Error('El numero de Fijos debe ser de 2 digitos (00-99)');
    }

    // Validar centenas (100-999)
    const centenasNum = parseInt(centenas, 10);
    if (!centenas || !/^\d{3}$/.test(centenas) || centenasNum < 100 || centenasNum > 999) {
        throw new Error('El numero de Centenas debe estar entre 100-999');
    }

    // Validar parles (1000-9999)
    const parlesNum = parseInt(parles, 10);
    if (!parles || !/^\d{4}$/.test(parles) || parlesNum < 1000 || parlesNum > 9999) {
        throw new Error('El numero de Parles debe estar entre 1000-9999');
    }

    return true;
}

/**
 * Obtener resumen de una apuesta ganadora
 */
async function getWinningSummary(betId) {
    const bet = await Bet.findById(betId);

    if (!bet) {
        throw new Error('Apuesta no encontrada');
    }

    if (bet.status !== 'won') {
        return null;
    }

    return {
        bet_id: bet.id,
        game_type: bet.game_type,
        bet_number: bet.bet_number,
        amount: bet.amount,
        multiplier: bet.multiplier,
        payout: bet.actual_payout,
        draw_id: bet.draw_id
    };
}

/**
 * Obtener todos los ganadores de un sorteo
 */
async function getDrawWinners(drawId) {
    const { query } = require('../config/database');

    const result = await query(
        `SELECT
            b.id,
            b.game_type,
            b.bet_number,
            b.amount,
            b.actual_payout,
            u.id as user_id,
            u.username
         FROM bets b
         JOIN users u ON b.user_id = u.id
         WHERE b.draw_id = $1
         AND b.status = 'won'
         AND b.is_corrido_child = false
         ORDER BY b.actual_payout DESC`,
        [drawId]
    );

    return result.rows;
}

/**
 * Calcular estadísticas de pagos de un sorteo
 */
async function calculateDrawPayoutStats(drawId) {
    const { query } = require('../config/database');

    const result = await query(
        `SELECT
            COUNT(CASE WHEN status = 'won' THEN 1 END) as winners_count,
            COUNT(CASE WHEN status = 'lost' THEN 1 END) as losers_count,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
            COALESCE(SUM(CASE WHEN status = 'won' THEN actual_payout ELSE 0 END), 0) as total_payouts,
            COALESCE(SUM(amount), 0) as total_wagered,
            COUNT(CASE WHEN status = 'won' AND game_type = 'fijos' THEN 1 END) as fijos_winners,
            COUNT(CASE WHEN status = 'won' AND game_type = 'centenas' THEN 1 END) as centenas_winners,
            COUNT(CASE WHEN status = 'won' AND game_type = 'parles' THEN 1 END) as parles_winners
         FROM bets
         WHERE draw_id = $1 AND is_corrido_child = false`,
        [drawId]
    );

    return result.rows[0];
}

/**
 * Registrar fee del operador para un sorteo
 */
async function recordOperatorFee(drawId, drawType, poolAmount) {
    const { query } = require('../config/database');
    const { OPERATOR_CONFIG } = require('../config/constants');

    // Determinar porcentaje según tipo de sorteo
    const feeBps = drawType === 'lottery'
        ? OPERATOR_CONFIG.FORTUNA_FEE_BPS
        : OPERATOR_CONFIG.BOLITA_FEE_BPS;

    const feePercentage = feeBps / 100; // Convertir bps a porcentaje
    const feeAmount = (poolAmount * feeBps) / 10000;

    if (feeAmount <= 0) {
        console.log(`No hay fee para registrar (pool: ${poolAmount})`);
        return null;
    }

    try {
        const result = await query(
            `INSERT INTO operator_fees
             (draw_id, draw_type, pool_amount, fee_percentage, fee_amount, operator_wallet, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending')
             RETURNING *`,
            [drawId, drawType, poolAmount, feePercentage, feeAmount, OPERATOR_CONFIG.WALLET_ADDRESS]
        );

        console.log(`Fee del operador registrado: $${feeAmount.toFixed(2)} (${feePercentage}% de $${poolAmount})`);
        return result.rows[0];
    } catch (error) {
        console.error('Error registrando fee del operador:', error);
        return null;
    }
}

/**
 * Procesar sorteo completo (usado por el scheduler después del VRF)
 * Obtiene los números ganadores del sorteo y procesa los pagos
 * @param {number} drawId - ID del sorteo
 */
async function processDraw(drawId) {
    const { query } = require('../config/database');

    // Obtener el sorteo con los números ganadores del VRF
    const drawResult = await query('SELECT * FROM draws WHERE id = $1', [drawId]);

    if (drawResult.rows.length === 0) {
        throw new Error('Sorteo no encontrado');
    }

    const draw = drawResult.rows[0];

    // Si es La Bolita, generar números ganadores del random number
    if (draw.draw_type === 'bolita' || !draw.draw_type) {
        // El VRF ya generó el winning_number, extraer los componentes
        let winningNumber = draw.winning_number || draw.vrf_random_number;

        if (!winningNumber) {
            throw new Error('No hay número ganador disponible');
        }

        // Si es un número muy grande (del VRF), tomar los últimos 4 dígitos
        if (winningNumber.length > 4) {
            winningNumber = winningNumber.slice(-4).padStart(4, '0');
        }

        const parles = winningNumber.padStart(4, '0');
        const centenas = parles.slice(-3);
        const fijos = parles.slice(-2);

        const winningNumbers = { fijos, centenas, parles };

        const result = await processDrawResults(drawId, winningNumbers);

        // Calcular y registrar fee del operador (20% del pool para La Bolita)
        const poolAmount = parseFloat(result.total_wagered || 0);
        if (poolAmount > 0) {
            await recordOperatorFee(drawId, 'bolita', poolAmount);
        }

        return {
            totalBets: result.bets_processed,
            totalPayouts: result.total_payouts,
            betsCount: result.bets_processed,
            winnersCount: result.winners_count
        };
    }

    // Si es La Fortuna (lottery), procesar de forma diferente
    if (draw.draw_type === 'lottery') {
        // Obtener el pool total de tickets vendidos
        const ticketStats = await query(
            `SELECT COUNT(*) as ticket_count, COALESCE(SUM(amount), 0) as total_pool
             FROM bets WHERE draw_id = $1 AND status = 'pending'`,
            [drawId]
        );

        const poolAmount = parseFloat(ticketStats.rows[0]?.total_pool || 0);

        // Registrar fee del operador (6% del pool para La Fortuna)
        if (poolAmount > 0) {
            await recordOperatorFee(drawId, 'lottery', poolAmount);
        }

        // TODO: Implementar procesamiento completo de premios de La Fortuna
        console.log(`Procesamiento de La Fortuna: pool=$${poolAmount}, tickets=${ticketStats.rows[0]?.ticket_count}`);

        return {
            totalBets: parseInt(ticketStats.rows[0]?.ticket_count || 0),
            totalPayouts: 0,
            betsCount: parseInt(ticketStats.rows[0]?.ticket_count || 0),
            winnersCount: 0
        };
    }

    throw new Error(`Tipo de sorteo no soportado: ${draw.draw_type}`);
}

/**
 * Obtener fees pendientes del operador
 */
async function getPendingOperatorFees() {
    const { query } = require('../config/database');

    const result = await query(
        `SELECT * FROM operator_fees WHERE status = 'pending' ORDER BY created_at ASC`
    );

    return result.rows;
}

/**
 * Obtener resumen de fees del operador
 */
async function getOperatorFeesSummary() {
    const { query } = require('../config/database');

    const result = await query(
        `SELECT
            draw_type,
            COUNT(*) as total_draws,
            SUM(CASE WHEN status = 'pending' THEN fee_amount ELSE 0 END) as pending_amount,
            SUM(CASE WHEN status = 'transferred' THEN fee_amount ELSE 0 END) as transferred_amount,
            SUM(fee_amount) as total_amount
         FROM operator_fees
         GROUP BY draw_type`
    );

    return result.rows;
}

module.exports = {
    processDraw,
    processDrawResults,
    validateWinningNumbers,
    getWinningSummary,
    getDrawWinners,
    calculateDrawPayoutStats,
    recordOperatorFee,
    getPendingOperatorFees,
    getOperatorFeesSummary
};
