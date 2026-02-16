/**
 * Prize Service
 * Handles all prize calculations and distributions for La Bolita and La Fortuna
 */

const {
    GAME_RULES,
    LOTTERY_RULES,
    LOTTERY_PRIZES,
    BOLITA_PRIZES,
    calculateLotteryCategory,
    getLotteryPrize,
    calculateJackpotContribution
} = require('../config/constants');

// =================================
// LA BOLITA PRIZE CALCULATIONS
// =================================

/**
 * Calculate payout for a La Bolita bet
 * @param {string} gameType - fijos, centenas, parles, or corrido
 * @param {string} betNumber - The number bet on
 * @param {number} amount - Bet amount in USDT
 * @param {string} winningNumber - The 4-digit winning number (e.g., "1234")
 * @returns {Object} { won: boolean, payout: number, multiplier: number }
 */
function calculateBolitaPayout(gameType, betNumber, amount, winningNumber) {
    const rules = GAME_RULES[gameType];
    if (!rules) {
        return { won: false, payout: 0, multiplier: 0, error: 'Invalid game type' };
    }

    // Extract the relevant winning digits based on game type
    let targetNumber;
    switch (gameType) {
        case 'fijos':
            // Last 2 digits
            targetNumber = winningNumber.slice(-2);
            break;
        case 'centenas':
            // Last 3 digits
            targetNumber = winningNumber.slice(-3);
            break;
        case 'parles':
            // All 4 digits
            targetNumber = winningNumber;
            break;
        default:
            return { won: false, payout: 0, multiplier: 0 };
    }

    // Pad the bet number to match length
    const paddedBetNumber = betNumber.toString().padStart(rules.digits, '0');

    // Check if it's a winner
    const won = paddedBetNumber === targetNumber;

    if (won) {
        // Use integer cents to avoid floating-point errors
        const amountCents = Math.round(amount * 100);
        const payout = amountCents * rules.multiplier / 100;
        return {
            won: true,
            payout,
            multiplier: rules.multiplier
        };
    }

    return { won: false, payout: 0, multiplier: rules.multiplier };
}

/**
 * Calculate total prizes for a La Bolita draw
 * @param {Array} bets - Array of bet objects with gameType, betNumber, amount
 * @param {string} winningNumber - The 4-digit winning number
 * @returns {Object} { winners: Array, totalPayout: number, breakdown: Object }
 */
function calculateDrawPrizes(bets, winningNumber) {
    const winners = [];
    let totalPayout = 0;
    const breakdown = {
        fijos: { count: 0, total: 0 },
        centenas: { count: 0, total: 0 },
        parles: { count: 0, total: 0 }
    };

    for (const bet of bets) {
        const betAmount = Math.round(parseFloat(bet.amount) * 100) / 100;
        const result = calculateBolitaPayout(
            bet.game_type,
            bet.bet_number,
            betAmount,
            winningNumber
        );

        if (result.won) {
            winners.push({
                betId: bet.id,
                userId: bet.user_id,
                gameType: bet.game_type,
                betNumber: bet.bet_number,
                amount: betAmount,
                payout: result.payout,
                multiplier: result.multiplier
            });

            totalPayout = Math.round((totalPayout + result.payout) * 100) / 100;

            if (breakdown[bet.game_type]) {
                breakdown[bet.game_type].count++;
                breakdown[bet.game_type].total += result.payout;
            }
        }
    }

    return { winners, totalPayout, breakdown };
}

// =================================
// LA FORTUNA PRIZE CALCULATIONS
// Sistema de 5 categorías con premios proporcionales
// =================================

/**
 * Calculate prize for a lottery ticket
 * @param {Array<number>} ticketNumbers - Array of 6 numbers (1-49)
 * @param {number} ticketKey - Key number (0-9)
 * @param {Array<number>} winningNumbers - Array of 6 winning numbers
 * @param {number} winningKey - Winning key number
 * @param {number} currentJackpot - Current jackpot amount
 * @param {number} totalPool - Total recaudado (opcional, para calcular premio real)
 * @param {number} winnersInCategory - Ganadores en la categoría (opcional)
 * @returns {Object} { category: number, prize: number, matches: number, keyMatch: boolean }
 */
function calculateLotteryTicketPrize(ticketNumbers, ticketKey, winningNumbers, winningKey, currentJackpot, totalPool = null, winnersInCategory = 1) {
    // Sort both arrays for comparison
    const sortedTicket = [...ticketNumbers].sort((a, b) => a - b);
    const sortedWinning = [...winningNumbers].sort((a, b) => a - b);

    // Count matches
    const matches = sortedTicket.filter(num => sortedWinning.includes(num)).length;
    const keyMatch = ticketKey === winningKey;

    // Get category (0 = no prize, 1-5 = prize categories)
    const category = calculateLotteryCategory(ticketNumbers, ticketKey, winningNumbers, winningKey);

    // Get prize amount
    const prize = getLotteryPrize(category, currentJackpot, totalPool, winnersInCategory);

    const categoryDescriptions = {
        1: '6 + Clave (Jackpot)',
        2: '6 Aciertos (40%)',
        3: '5 Aciertos (5%)',
        4: '4 Aciertos (3%)',
        5: '3 Aciertos (6%)'
    };

    return {
        category,
        prize,
        matches,
        keyMatch,
        description: category > 0 ? categoryDescriptions[category] : 'Sin premio'
    };
}

/**
 * Calculate all prizes for a lottery draw
 * Sistema de 5 categorías con premios proporcionales
 * @param {Array} tickets - Array of ticket objects
 * @param {Array<number>} winningNumbers - Winning numbers
 * @param {number} winningKey - Winning key number
 * @param {number} currentJackpot - Current jackpot
 * @returns {Object} { winners: Array, totalPayout: number, categoryBreakdown: Object, jackpotWon: boolean }
 */
function calculateLotteryDrawPrizes(tickets, winningNumbers, winningKey, currentJackpot) {
    // Calcular total recaudado
    const totalPool = tickets.length * 1; // $1 por ticket

    // Primera pasada: contar ganadores por categoría
    const categoryBreakdown = {};
    for (let i = 1; i <= 5; i++) {
        categoryBreakdown[i] = { count: 0, total: 0, ticketData: [] };
    }

    for (const ticket of tickets) {
        const category = calculateLotteryCategory(
            ticket.numbers,
            ticket.keyNumber,
            winningNumbers,
            winningKey
        );

        if (category > 0) {
            categoryBreakdown[category].count++;
            categoryBreakdown[category].ticketData.push(ticket);
        }
    }

    // Segunda pasada: calcular premios proporcionales
    const winners = [];
    let totalPayout = 0;
    let jackpotWon = false;

    for (let cat = 1; cat <= 5; cat++) {
        const catData = categoryBreakdown[cat];
        if (catData.count === 0) continue;

        // Calcular premio por ganador
        let prizePerWinner;
        if (cat === 1) {
            prizePerWinner = currentJackpot / catData.count;
            jackpotWon = true;
        } else {
            prizePerWinner = getLotteryPrize(cat, 0, totalPool, catData.count);
        }

        // Redondear a 2 decimales
        prizePerWinner = Math.floor(prizePerWinner * 100) / 100;

        for (const ticket of catData.ticketData) {
            const matches = ticket.numbers.filter(num => winningNumbers.includes(num)).length;
            const keyMatch = ticket.keyNumber === winningKey;

            winners.push({
                ticketId: ticket.id,
                userId: ticket.user_id,
                numbers: ticket.numbers,
                keyNumber: ticket.keyNumber,
                category: cat,
                prize: prizePerWinner,
                matches,
                keyMatch
            });

            totalPayout += prizePerWinner;
            categoryBreakdown[cat].total += prizePerWinner;
        }
    }

    return {
        winners,
        totalPayout,
        totalPool,
        categoryBreakdown,
        jackpotWon,
        winningNumbers,
        winningKey
    };
}

// =================================
// JACKPOT MANAGEMENT
// =================================

/**
 * Process ticket sale contribution to jackpot
 * @param {number} ticketPrice - Price of ticket in USDT
 * @param {number} currentJackpot - Current jackpot amount
 * @returns {Object} { newJackpot: number, contribution: number, overflow: number, capped: boolean }
 */
function processJackpotContribution(ticketPrice, currentJackpot) {
    const result = calculateJackpotContribution(ticketPrice, currentJackpot);

    return {
        newJackpot: Math.min(currentJackpot + result.toJackpot, LOTTERY_PRIZES.jackpot.cap),
        contribution: result.toJackpot,
        overflow: result.overflow,
        capped: result.capped
    };
}

/**
 * Reset jackpot after it's been won
 * @returns {number} New jackpot starting amount
 */
function resetJackpot() {
    return LOTTERY_PRIZES.jackpot.minStart;
}

/**
 * Get jackpot status
 * @param {number} currentJackpot - Current jackpot amount
 * @returns {Object} { amount: number, cap: number, percentToCAP: number, capped: boolean }
 */
function getJackpotStatus(currentJackpot) {
    const cap = LOTTERY_PRIZES.jackpot.cap;
    return {
        amount: currentJackpot,
        cap,
        percentToCAP: Math.min((currentJackpot / cap) * 100, 100).toFixed(2),
        capped: currentJackpot >= cap
    };
}

// =================================
// PRIZE DISTRIBUTION CALCULATIONS
// =================================

/**
 * Calculate revenue distribution for La Bolita bets
 * @param {number} totalBetAmount - Total amount bet
 * @returns {Object} { prizepool: number, operations: number, reserve: number }
 */
function calculateBolitaDistribution(totalBetAmount) {
    const { distribution } = BOLITA_PRIZES;
    return {
        prizepool: (totalBetAmount * distribution.prizepoolBps) / 10000,
        operations: (totalBetAmount * distribution.operationsBps) / 10000,
        reserve: (totalBetAmount * distribution.reserveBps) / 10000
    };
}

/**
 * Calculate revenue distribution for La Fortuna tickets
 * @param {number} totalTicketSales - Total ticket sales amount
 * @param {number} currentJackpot - Current jackpot (to check cap)
 * @returns {Object} { jackpot: number, prizepool: number, operations: number, reserve: number, overflow: number }
 */
function calculateLotteryDistribution(totalTicketSales, currentJackpot) {
    const { distribution, jackpot: jackpotConfig } = LOTTERY_PRIZES;

    // Calculate each portion
    let jackpotPortion = (totalTicketSales * distribution.jackpotBps) / 10000;
    let overflow = 0;

    // Check if jackpot would exceed cap
    if (currentJackpot + jackpotPortion > jackpotConfig.cap) {
        overflow = (currentJackpot + jackpotPortion) - jackpotConfig.cap;
        jackpotPortion = jackpotConfig.cap - currentJackpot;
    }

    return {
        jackpot: jackpotPortion,
        prizepool: (totalTicketSales * distribution.prizepoolBps) / 10000 + overflow,
        operations: (totalTicketSales * distribution.operationsBps) / 10000,
        reserve: (totalTicketSales * distribution.reserveBps) / 10000,
        overflow
    };
}

// =================================
// EXPORTS
// =================================

module.exports = {
    // La Bolita
    calculateBolitaPayout,
    calculateDrawPrizes,
    calculateBolitaDistribution,

    // La Fortuna
    calculateLotteryTicketPrize,
    calculateLotteryDrawPrizes,
    calculateLotteryDistribution,

    // Jackpot
    processJackpotContribution,
    resetJackpot,
    getJackpotStatus,

    // Config exports (for convenience)
    LOTTERY_RULES,
    LOTTERY_PRIZES,
    BOLITA_PRIZES
};
