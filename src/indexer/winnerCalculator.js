const { query, getClient } = require('../config/database');
const {
    calculateLotteryCategory,
    getLotteryPrize,
    LOTTERY_PRIZES
} = require('../config/constants');

// =================================
// CALCULADOR DE GANADORES
// Para La Fortuna (Lottery 6/49 + clave)
// Sistema de 5 categorías con premios proporcionales
// Todas las operaciones envueltas en transacción
// =================================

class WinnerCalculator {
    /**
     * Calcular ganadores de un sorteo de La Fortuna
     * Todo el settlement es atómico dentro de una transacción
     * @param {number} drawId - ID del sorteo
     * @returns {Object} - Estadísticas y lista de ganadores
     */
    static async calculateWinners(drawId) {
        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Obtener datos del sorteo con lock
            const drawResult = await client.query(
                'SELECT * FROM draws WHERE id = $1 AND draw_type = $2 FOR UPDATE',
                [drawId, 'lottery']
            );

            if (drawResult.rows.length === 0) {
                throw new Error('Sorteo no encontrado o no es de tipo lottery');
            }

            const draw = drawResult.rows[0];

            if (draw.status === 'completed') {
                throw new Error('El sorteo ya fue resuelto');
            }

            if (!draw.lottery_numbers || draw.lottery_key === null) {
                throw new Error('El sorteo no tiene números ganadores definidos');
            }

            const winningNumbers = Array.isArray(draw.lottery_numbers)
                ? draw.lottery_numbers
                : JSON.parse(draw.lottery_numbers);
            const winningKey = draw.lottery_key;

            console.log(`[WinnerCalculator] Calculando ganadores para sorteo ${draw.draw_number}`);
            console.log(`[WinnerCalculator] Números ganadores: ${winningNumbers.join(', ')} + ${winningKey}`);

            // Obtener todos los tickets activos del sorteo
            const ticketsResult = await client.query(
                'SELECT * FROM lottery_tickets WHERE draw_id = $1 AND status = $2',
                [drawId, 'active']
            );

            const tickets = ticketsResult.rows;
            console.log(`[WinnerCalculator] Total de tickets: ${tickets.length}`);

            if (tickets.length === 0) {
                // No tickets — mark draw as completed and return
                await client.query(
                    "UPDATE draws SET status = 'completed', updated_at = NOW() WHERE id = $1",
                    [drawId]
                );
                await client.query('COMMIT');
                return {
                    drawId,
                    drawNumber: draw.draw_number,
                    winningNumbers,
                    winningKey,
                    totalTickets: 0,
                    totalPool: 0,
                    totalWinners: 0,
                    totalPrize: 0,
                    categoryStats: {},
                    winners: []
                };
            }

            // Obtener total recaudado
            const totalPool = tickets.length * 1; // $1 USDT por ticket
            console.log(`[WinnerCalculator] Total recaudado: ${totalPool} USDT`);

            // Obtener jackpot actual
            const jackpotResult = await client.query(
                'SELECT jackpot_amount FROM jackpot_status ORDER BY updated_at DESC LIMIT 1 FOR UPDATE'
            );
            const jackpotAmount = jackpotResult.rows.length > 0
                ? parseFloat(jackpotResult.rows[0].jackpot_amount)
                : 0;

            // Primera pasada: contar ganadores por categoría
            const categoryStats = {};
            for (let cat = 1; cat <= 5; cat++) {
                categoryStats[cat] = { count: 0, totalPrize: 0, winnersData: [] };
            }

            for (const ticket of tickets) {
                const ticketNumbers = typeof ticket.numbers === 'string'
                    ? JSON.parse(ticket.numbers)
                    : ticket.numbers;
                const ticketKey = ticket.key_number;

                const category = calculateLotteryCategory(
                    ticketNumbers,
                    ticketKey,
                    winningNumbers,
                    winningKey
                );

                if (category > 0) {
                    categoryStats[category].count++;
                    categoryStats[category].winnersData.push({
                        ticket,
                        ticketNumbers,
                        ticketKey,
                        matches: this.countMatches(ticketNumbers, winningNumbers),
                        key_match: ticketKey === winningKey
                    });
                }
            }

            // Segunda pasada: calcular premios proporcionales y crear ganadores
            const winners = [];
            let totalPrize = 0;

            for (let cat = 1; cat <= 5; cat++) {
                const catData = categoryStats[cat];
                if (catData.count === 0) continue;

                let prizePerWinner;
                if (cat === 1) {
                    // Jackpot: se divide entre todos los ganadores de cat 1
                    prizePerWinner = jackpotAmount / catData.count;
                } else {
                    // Otras categorías: (totalPool * BPS / 10000) / numGanadores
                    prizePerWinner = getLotteryPrize(cat, 0, totalPool, catData.count);
                }

                // Redondear a 2 decimales (floor para no exceder pool)
                prizePerWinner = Math.floor(prizePerWinner * 100) / 100;

                for (const winnerData of catData.winnersData) {
                    winners.push({
                        draw_id: drawId,
                        user_address: winnerData.ticket.user_address,
                        ticket_id: winnerData.ticket.ticket_id,
                        ticket_numbers: winnerData.ticketNumbers,
                        ticket_key: winnerData.ticketKey,
                        matches: winnerData.matches,
                        key_match: winnerData.key_match,
                        category: cat,
                        prize_amount: prizePerWinner
                    });

                    categoryStats[cat].totalPrize += prizePerWinner;
                    totalPrize += prizePerWinner;

                    // Actualizar estado del ticket a 'won' (matches DB CHECK constraint)
                    await client.query(
                        'UPDATE lottery_tickets SET status = $1, matches = $2, key_match = $3, prize_amount = $4 WHERE id = $5',
                        ['won', winnerData.matches, winnerData.key_match, prizePerWinner, winnerData.ticket.id]
                    );
                }
            }

            // Marcar todos los tickets perdedores en batch (matches DB CHECK 'lost')
            await client.query(
                "UPDATE lottery_tickets SET status = 'lost' WHERE draw_id = $1 AND status = 'active'",
                [drawId]
            );

            // Guardar ganadores en la BD
            for (const winner of winners) {
                await this.saveWinner(client, winner);
            }

            // Disbursement: acreditar premios al balance de los ganadores
            for (const winner of winners) {
                if (winner.prize_amount > 0) {
                    await client.query(
                        'UPDATE users SET balance = balance + $1 WHERE wallet_address = $2',
                        [winner.prize_amount, winner.user_address.toLowerCase()]
                    );
                }
            }

            // Si hubo ganador de jackpot (cat 1), resetear jackpot a 0
            if (categoryStats[1].count > 0) {
                await client.query(
                    'UPDATE jackpot_status SET jackpot_amount = 0, last_won_at = NOW(), last_won_by = $1, last_won_draw_id = $2, updated_at = NOW() WHERE id = (SELECT id FROM jackpot_status ORDER BY updated_at DESC LIMIT 1)',
                    [categoryStats[1].winnersData[0].ticket.user_address, drawId]
                );
            }

            // Marcar draw como completado
            await client.query(`
                UPDATE draws
                SET status = 'completed',
                    winners_count = $1,
                    total_payouts_amount = $2,
                    updated_at = NOW()
                WHERE id = $3
            `, [winners.length, totalPrize, drawId]);

            await client.query('COMMIT');

            console.log(`[WinnerCalculator] Ganadores encontrados: ${winners.length}`);
            console.log(`[WinnerCalculator] Premio total: ${totalPrize} USDT`);

            return {
                drawId,
                drawNumber: draw.draw_number,
                winningNumbers,
                winningKey,
                totalTickets: tickets.length,
                totalPool,
                totalWinners: winners.length,
                totalPrize,
                categoryStats,
                winners
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`[WinnerCalculator] Error calculando ganadores del sorteo ${drawId}:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Contar coincidencias entre dos arrays de números
     */
    static countMatches(ticketNumbers, winningNumbers) {
        return ticketNumbers.filter(num => winningNumbers.includes(num)).length;
    }

    /**
     * Guardar ganador en la BD (transactional)
     */
    static async saveWinner(client, winner) {
        const text = `
            INSERT INTO lottery_winners
            (draw_id, user_address, ticket_id, ticket_numbers, ticket_key,
             matches, key_match, category, prize_amount)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (draw_id, ticket_id) DO UPDATE
            SET prize_amount = EXCLUDED.prize_amount,
                category = EXCLUDED.category
            RETURNING *
        `;
        const values = [
            winner.draw_id,
            winner.user_address.toLowerCase(),
            winner.ticket_id,
            JSON.stringify(winner.ticket_numbers),
            winner.ticket_key,
            winner.matches,
            winner.key_match,
            winner.category,
            winner.prize_amount
        ];

        const result = await client.query(text, values);
        return result.rows[0];
    }

    /**
     * Obtener ganadores de un sorteo
     */
    static async getWinners(drawId, { category = null } = {}) {
        let text = `
            SELECT * FROM lottery_winners
            WHERE draw_id = $1
        `;
        const values = [drawId];

        if (category) {
            text += ' AND category = $2';
            values.push(category);
        }

        text += ' ORDER BY category ASC, prize_amount DESC';

        const result = await query(text, values);
        return result.rows;
    }

    /**
     * Obtener ganadores de un usuario
     */
    static async getUserWinnings(userAddress, { drawId = null } = {}) {
        let text = `
            SELECT lw.*, d.draw_number, d.lottery_numbers, d.lottery_key
            FROM lottery_winners lw
            JOIN draws d ON lw.draw_id = d.id
            WHERE lw.user_address = $1
        `;
        const values = [userAddress.toLowerCase()];

        if (drawId) {
            text += ' AND lw.draw_id = $2';
            values.push(drawId);
        }

        text += ' ORDER BY d.scheduled_time DESC, lw.category ASC';

        const result = await query(text, values);
        return result.rows;
    }

    /**
     * Obtener estadísticas de categorías de un sorteo
     * Sistema de 5 categorías
     */
    static async getCategoryStats(drawId) {
        const text = `
            SELECT
                category,
                COUNT(*) as winner_count,
                SUM(prize_amount) as total_prize,
                AVG(prize_amount) as avg_prize
            FROM lottery_winners
            WHERE draw_id = $1 AND category BETWEEN 1 AND 5
            GROUP BY category
            ORDER BY category
        `;
        const result = await query(text, [drawId]);

        const categoryNames = {
            1: '6 + Clave (Jackpot)',
            2: '6 Aciertos (40%)',
            3: '5 Aciertos (5%)',
            4: '4 Aciertos (3%)',
            5: '3 Aciertos (6%)'
        };

        return result.rows.map(row => ({
            ...row,
            category_name: categoryNames[row.category] || `Categoría ${row.category}`
        }));
    }
}

module.exports = WinnerCalculator;
