const { query } = require('../config/database');
const {
    calculateLotteryCategory,
    getLotteryPrize,
    LOTTERY_PRIZES
} = require('../config/constants');

// =================================
// CALCULADOR DE GANADORES
// Para La Fortuna (Lottery 6/49 + clave)
// Sistema de 5 categorías con premios proporcionales
// =================================

class WinnerCalculator {
    /**
     * Calcular ganadores de un sorteo de La Fortuna
     * @param {number} drawId - ID del sorteo
     * @returns {Object} - Estadísticas y lista de ganadores
     */
    static async calculateWinners(drawId) {
        // Obtener datos del sorteo
        const drawResult = await query(
            'SELECT * FROM draws WHERE id = $1 AND draw_type = $2',
            [drawId, 'lottery']
        );

        if (drawResult.rows.length === 0) {
            throw new Error('Sorteo no encontrado o no es de tipo lottery');
        }

        const draw = drawResult.rows[0];

        if (!draw.lottery_numbers || draw.lottery_key === null) {
            throw new Error('El sorteo no tiene números ganadores definidos');
        }

        const winningNumbers = JSON.parse(draw.lottery_numbers);
        const winningKey = draw.lottery_key;

        console.log(`Calculando ganadores para sorteo ${draw.draw_number}`);
        console.log(`Números ganadores: ${winningNumbers.join(', ')} + ${winningKey}`);

        // Obtener todos los tickets del sorteo
        const ticketsResult = await query(
            'SELECT * FROM lottery_tickets WHERE draw_id = $1 AND status = $2',
            [drawId, 'active']
        );

        const tickets = ticketsResult.rows;
        console.log(`Total de tickets: ${tickets.length}`);

        // Obtener total recaudado (para calcular premios proporcionales)
        const totalPool = tickets.length * 1; // $1 USDT por ticket
        console.log(`Total recaudado: ${totalPool} USDT`);

        // Obtener jackpot actual (para categoría 1)
        const jackpotAmount = draw.jackpot_amount || LOTTERY_PRIZES.jackpot.minStart;

        // Primera pasada: contar ganadores por categoría
        const categoryStats = {};
        for (let cat = 1; cat <= 5; cat++) {
            categoryStats[cat] = { count: 0, totalPrize: 0, winnersData: [] };
        }

        for (const ticket of tickets) {
            const ticketNumbers = JSON.parse(ticket.numbers);
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

        // Segunda pasada: calcular premios proporcionales
        const winners = [];

        for (let cat = 1; cat <= 5; cat++) {
            const catData = categoryStats[cat];
            if (catData.count === 0) continue;

            // Calcular premio por ganador en esta categoría
            let prizePerWinner;
            if (cat === 1) {
                // Jackpot: se divide entre todos los ganadores de cat 1
                prizePerWinner = jackpotAmount / catData.count;
            } else {
                // Otras categorías: (totalPool * BPS / 10000) / numGanadores
                prizePerWinner = getLotteryPrize(cat, 0, totalPool, catData.count);
            }

            // Redondear a 2 decimales
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

                // Actualizar estado del ticket
                await query(
                    'UPDATE lottery_tickets SET status = $1 WHERE id = $2',
                    ['winner', winnerData.ticket.id]
                );
            }
        }

        // Marcar tickets perdedores
        for (const ticket of tickets) {
            const ticketNumbers = JSON.parse(ticket.numbers);
            const ticketKey = ticket.key_number;
            const category = calculateLotteryCategory(ticketNumbers, ticketKey, winningNumbers, winningKey);

            if (category === 0) {
                await query(
                    'UPDATE lottery_tickets SET status = $1 WHERE id = $2',
                    ['loser', ticket.id]
                );
            }
        }

        // Guardar ganadores en la BD
        for (const winner of winners) {
            await this.saveWinner(winner);
        }

        // Calcular totales
        const totalWinners = winners.length;
        const totalPrize = winners.reduce((sum, w) => sum + w.prize_amount, 0);

        console.log(`Ganadores encontrados: ${totalWinners}`);
        console.log(`Premio total: ${totalPrize} USDT`);

        return {
            drawId,
            drawNumber: draw.draw_number,
            winningNumbers,
            winningKey,
            totalTickets: tickets.length,
            totalPool,
            totalWinners,
            totalPrize,
            categoryStats,
            winners
        };
    }

    /**
     * Contar coincidencias entre dos arrays de números
     */
    static countMatches(ticketNumbers, winningNumbers) {
        return ticketNumbers.filter(num => winningNumbers.includes(num)).length;
    }

    /**
     * Guardar ganador en la BD
     */
    static async saveWinner(winner) {
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

        const result = await query(text, values);
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

        // Agregar info de categoría
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
