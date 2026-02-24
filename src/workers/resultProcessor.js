const Draw = require('../models/Draw');
const Bet = require('../models/Bet');
const AuditLog = require('../models/AuditLog');
const DrawStateMachine = require('./drawStateMachine');
const {
    AUDIT_ACTIONS,
    GAME_RULES,
    extractWinningNumbers,
    calculateLotteryCategory,
    getLotteryPrize
} = require('../config/constants');

// =================================
// RESULT PROCESSOR
// Procesa resultados de sorteos y calcula ganadores
// =================================

class ResultProcessor {
    /**
     * Procesar resultado de un sorteo de La Bolita
     */
    async processBolitaResult(drawId) {
        const draw = await Draw.findById(drawId);

        if (!draw) {
            throw new Error('Sorteo no encontrado');
        }

        if (!draw.winning_number) {
            throw new Error('El sorteo no tiene número ganador');
        }

        // Extraer números ganadores
        const winningNumbers = extractWinningNumbers(draw.winning_number);

        console.log(`Procesando La Bolita ${draw.draw_number}: ${draw.winning_number}`);
        console.log(`  Fijos: ${winningNumbers.fijos}`);
        console.log(`  Centenas: ${winningNumbers.centenas}`);
        console.log(`  Parles: ${winningNumbers.parles}`);

        // Obtener todas las apuestas del sorteo
        const bets = await Bet.findByDraw(drawId);

        let winnersCount = 0;
        let totalPayouts = 0;

        for (const bet of bets) {
            const result = this.checkBolitaWinner(bet, winningNumbers);

            if (result.won) {
                winnersCount++;
                totalPayouts += result.payout;

                // Actualizar apuesta como ganadora
                await Bet.update(bet.id, {
                    status: 'won',
                    payout_amount: result.payout
                });
            } else {
                // Marcar como perdida
                await Bet.update(bet.id, {
                    status: 'lost',
                    payout_amount: 0
                });
            }
        }

        console.log(`  Ganadores: ${winnersCount}, Pagos: ${totalPayouts} USDT`);

        return {
            drawId,
            winningNumber: draw.winning_number,
            betsCount: bets.length,
            winnersCount,
            totalPayouts
        };
    }

    /**
     * Verificar si una apuesta de La Bolita ganó
     */
    checkBolitaWinner(bet, winningNumbers) {
        const betNumber = bet.number.padStart(4, '0');
        let won = false;
        let multiplier = 0;

        switch (bet.game_type) {
            case 'fijos':
                won = betNumber.slice(-2) === winningNumbers.fijos;
                multiplier = GAME_RULES.fijos.multiplier;
                break;
            case 'centenas':
                won = betNumber.slice(-3) === winningNumbers.centenas;
                multiplier = GAME_RULES.centenas.multiplier;
                break;
            case 'parles':
                won = betNumber === winningNumbers.parles;
                multiplier = GAME_RULES.parles.multiplier;
                break;
            case 'corrido':
                // Corrido gana si coinciden los primeros 2 o los últimos 2
                const first2 = betNumber.slice(0, 2);
                const last2 = betNumber.slice(-2);
                won = first2 === winningNumbers.fijos || last2 === winningNumbers.fijos;
                multiplier = GAME_RULES.corrido ? GAME_RULES.corrido.multiplier : 30;
                break;
        }

        const payout = won ? bet.amount * multiplier : 0;

        return { won, payout, multiplier };
    }

    /**
     * Procesar resultado de un sorteo de La Fortuna
     * Sistema de 5 categorías con premios proporcionales
     */
    async processLotteryResult(drawId) {
        const draw = await Draw.findById(drawId);

        if (!draw) {
            throw new Error('Sorteo no encontrado');
        }

        if (!draw.lottery_numbers || draw.lottery_key === null) {
            throw new Error('El sorteo no tiene números ganadores');
        }

        const winningNumbers = JSON.parse(draw.lottery_numbers);
        const winningKey = draw.lottery_key;

        console.log(`Procesando La Fortuna ${draw.draw_number}:`);
        console.log(`  Números: ${winningNumbers.join(', ')}`);
        console.log(`  Clave: ${winningKey}`);

        // Obtener todos los tickets del sorteo
        const tickets = await this.getLotteryTickets(drawId);

        // Total recaudado ($1 por ticket)
        const totalPool = tickets.length * 1;

        // 5 categorías
        const winners = {
            1: [], 2: [], 3: [], 4: [], 5: []
        };

        // Primera pasada: clasificar ganadores por categoría
        for (const ticket of tickets) {
            const ticketNumbers = JSON.parse(ticket.numbers);
            const ticketKey = ticket.key_number;

            const category = calculateLotteryCategory(
                ticketNumbers,
                ticketKey,
                winningNumbers,
                winningKey
            );

            if (category > 0 && category <= 5) {
                winners[category].push({
                    ticketId: ticket.id,
                    userAddress: ticket.user_address,
                    category
                });
            }
        }

        // Segunda pasada: calcular premios proporcionales
        const categoryNames = {
            1: '6+Clave (Jackpot)',
            2: '6 Aciertos (40%)',
            3: '5 Aciertos (5%)',
            4: '4 Aciertos (3%)',
            5: '3 Aciertos (6%)'
        };

        // BPS por categoría (del total recaudado)
        const categoryBps = {
            1: 'jackpot',
            2: 4000,  // 40%
            3: 500,   // 5%
            4: 300,   // 3%
            5: 600    // 6%
        };

        let totalWinners = 0;
        let totalPayouts = 0;

        for (let cat = 1; cat <= 5; cat++) {
            const catWinners = winners[cat];
            if (catWinners.length === 0) {
                console.log(`  ${categoryNames[cat]}: 0 ganadores`);
                continue;
            }

            // Calcular premio por ganador
            let prizePerWinner;
            if (cat === 1) {
                // Jackpot dividido entre ganadores
                prizePerWinner = (draw.jackpot_amount || 0) / catWinners.length;
            } else {
                // Premio proporcional: (totalPool * BPS / 10000) / numGanadores
                const categoryPool = (totalPool * categoryBps[cat]) / 10000;
                prizePerWinner = categoryPool / catWinners.length;
            }

            // Redondear a 2 decimales
            prizePerWinner = Math.floor(prizePerWinner * 100) / 100;

            // Asignar premio a cada ganador
            for (const winner of catWinners) {
                winner.prize = prizePerWinner;
                totalPayouts += prizePerWinner;
            }

            totalWinners += catWinners.length;
            console.log(`  ${categoryNames[cat]}: ${catWinners.length} ganadores, $${prizePerWinner} c/u`);
        }

        return {
            drawId,
            winningNumbers,
            winningKey,
            ticketsCount: tickets.length,
            totalPool,
            winnersCount: totalWinners,
            totalPayouts,
            winnersByCategory: winners
        };
    }

    /**
     * Obtener tickets de lotería (placeholder - implementar según modelo)
     */
    async getLotteryTickets(drawId) {
        // TODO: Implementar cuando exista el modelo de tickets de lotería
        // Por ahora retorna array vacío
        return [];
    }

    /**
     * Procesar resultado genérico
     */
    async processResult(drawId) {
        const draw = await Draw.findById(drawId);

        if (!draw) {
            throw new Error('Sorteo no encontrado');
        }

        if (draw.draw_type === 'lottery') {
            return await this.processLotteryResult(drawId);
        } else {
            return await this.processBolitaResult(drawId);
        }
    }
}

module.exports = new ResultProcessor();
