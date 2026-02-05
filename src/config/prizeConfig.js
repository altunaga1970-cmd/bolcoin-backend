// =================================
// PRIZE CONFIGURATION - ADVANCED BPS SYSTEM
// =================================

/**
 * All values in BPS (basis points) where 10000 = 100%
 * This allows for precise percentage calculations without floating point errors
 */

// =================================
// LA FORTUNA (LOTTERY) CONFIGURATION
// =================================

const LOTTERY_CONFIG = {
    // Ticket configuration
    ticket: {
        priceUSDT: 1,              // $1 USDT per ticket
        maxPerTransaction: 8,      // Max tickets per tx
        maxPerDraw: 100            // Max tickets per user per draw
    },

    // Revenue distribution (total = 10000 BPS = 100%)
    // Distribución directa del total recaudado
    revenueDistribution: {
        jackpotBps: 2000,          // 20% al jackpot progresivo (6+clave)
        cat6Bps: 4000,             // 40% a repartir entre ganadores de 6 aciertos
        cat5Bps: 500,              // 5% a repartir entre ganadores de 5 aciertos
        cat4Bps: 300,              // 3% a repartir entre ganadores de 4 aciertos
        cat3Bps: 600,              // 6% a repartir entre ganadores de 3 aciertos
        operatorBps: 600,          // 6% fee operador
        reserveBps: 2000           // 20% a reservas de premios
        // Total: 2000+4000+500+300+600+600+2000 = 10000 BPS = 100%
    },

    // Jackpot configuration
    jackpot: {
        capUSDT: 1000000,          // $1M USDT maximum
        minStartUSDT: 0,           // Jackpot inicia en 0
        rolloverOnNoWinner: true,  // Jackpot se acumula si no hay ganador
        overflowTarget: 'reserve'  // Si alcanza el cap, va a reservas
    },

    // Prize distribution by category (BPS del total recaudado)
    // Categoría 1 (6+clave) es el jackpot progresivo
    // Las demás categorías reciben porcentaje del total a repartir entre ganadores
    categoryDistribution: {
        1: 'jackpot',  // 6+clave = Jackpot progresivo (20% acumulado)
        2: 4000,       // 6 aciertos = 40% del total a repartir
        3: 500,        // 5 aciertos = 5% del total a repartir
        4: 300,        // 4 aciertos = 3% del total a repartir
        5: 600         // 3 aciertos = 6% del total a repartir
        // Total premios: 54% (el resto es jackpot 20%, fee 6%, reserva 20%)
    },

    // Mínimo garantizado por categoría (en USDT)
    // Si no hay suficiente pool, se paga de reservas
    minimumPrizes: {
        1: 'jackpot',  // Jackpot (dinámico, puede ser 0)
        2: 0,          // Sin mínimo garantizado - se reparte lo recaudado
        3: 0,          // Sin mínimo garantizado
        4: 0,          // Sin mínimo garantizado
        5: 0           // Sin mínimo garantizado
    },

    // Sin máximos - se reparte todo lo recaudado entre ganadores
    maximumPrizes: {
        1: 1000000,    // Jackpot cap $1M
        2: null,       // Sin límite
        3: null,       // Sin límite
        4: null,       // Sin límite
        5: null        // Sin límite
    },

    // Claims configuration
    claims: {
        periodDays: 30,            // Days to claim prize
        warningDays: 7,            // Warning when X days remaining
        extensionAllowed: false    // No extensions
    }
};

// =================================
// LA BOLITA (NUMBERS) CONFIGURATION
// Sistema de Bankroll y Límites Dinámicos
// =================================

const BOLITA_CONFIG = {
    // Multiplicadores de premio
    multipliers: {
        fijos: 65,      // 65x
        centenas: 300,  // 300x
        parles: 1000    // 1000x
    },

    // Sistema de límites por número
    numberLimits: {
        initial: 2,     // 2 USDT máximo por número al inicio
        max: 1000,      // 1000 USDT máximo por número (objetivo)
        min: 2          // Mínimo siempre 2 USDT
    },

    // Distribución del pool CUANDO HAY GANADOR
    distributionWithWinner: {
        feeBps: 500,           // 5% fee operador
        reserveBps: 6500,      // 65% a reserva de premios
        bankrollBps: 3000      // 30% a bankroll
    },

    // Distribución del pool CUANDO NO HAY GANADOR
    distributionNoWinner: {
        feeBps: 500,           // 5% fee operador
        reserveBps: 4500,      // 45% a reserva de premios
        bankrollBps: 5000      // 50% a bankroll
    },

    // Capital inicial requerido para operar
    initialReserve: 1000       // 1000 USDT
};

// =================================
// HELPER FUNCTIONS
// =================================

/**
 * Convert BPS to percentage
 * @param {number} bps - Basis points
 * @returns {number} Percentage (e.g., 1500 BPS = 15)
 */
function bpsToPercent(bps) {
    return bps / 100;
}

/**
 * Convert percentage to BPS
 * @param {number} percent - Percentage
 * @returns {number} Basis points (e.g., 15% = 1500 BPS)
 */
function percentToBps(percent) {
    return percent * 100;
}

/**
 * Calculate amount from BPS
 * @param {number} amount - Base amount
 * @param {number} bps - Basis points
 * @returns {number} Calculated amount
 */
function calculateFromBps(amount, bps) {
    return (amount * bps) / 10000;
}

/**
 * Validate BPS distribution totals 10000
 * @param {Object} distribution - Distribution object with BPS values
 * @returns {boolean} True if valid
 */
function validateDistribution(distribution) {
    const total = Object.values(distribution).reduce((sum, bps) => sum + bps, 0);
    return total === 10000;
}

/**
 * Get category name by number
 * @param {number} category - Category number (1-5)
 * @returns {Object} Category info
 *
 * Sistema simplificado:
 * - Categoría 1: 6 + Clave = Jackpot progresivo
 * - Categoría 2: 6 aciertos = 40% del total
 * - Categoría 3: 5 aciertos = 5% del total
 * - Categoría 4: 4 aciertos = 3% del total
 * - Categoría 5: 3 aciertos = 6% del total
 */
function getCategoryInfo(category) {
    const categories = {
        1: { matches: 6, keyMatch: true, name: 'Jackpot', nameEs: '6 + Clave (Jackpot)', percentBps: 2000, percentLabel: '20% acumulado' },
        2: { matches: 6, keyMatch: false, name: '6 Matches', nameEs: '6 Aciertos', percentBps: 4000, percentLabel: '40% a repartir' },
        3: { matches: 5, keyMatch: null, name: '5 Matches', nameEs: '5 Aciertos', percentBps: 500, percentLabel: '5% a repartir' },
        4: { matches: 4, keyMatch: null, name: '4 Matches', nameEs: '4 Aciertos', percentBps: 300, percentLabel: '3% a repartir' },
        5: { matches: 3, keyMatch: null, name: '3 Matches', nameEs: '3 Aciertos', percentBps: 600, percentLabel: '6% a repartir' }
    };
    return categories[category] || null;
}

/**
 * Get all categories with full info
 * @returns {Array} Array of category objects
 */
function getAllCategories() {
    const categories = [];
    for (let i = 1; i <= 5; i++) {
        const info = getCategoryInfo(i);
        categories.push({
            category: i,
            ...info,
            minPrize: LOTTERY_CONFIG.minimumPrizes[i],
            maxPrize: LOTTERY_CONFIG.maximumPrizes[i] || null,
            poolShareBps: LOTTERY_CONFIG.categoryDistribution[i]
        });
    }
    return categories;
}

// =================================
// EXPORTS
// =================================

module.exports = {
    LOTTERY_CONFIG,
    BOLITA_CONFIG,

    // Helper functions
    bpsToPercent,
    percentToBps,
    calculateFromBps,
    validateDistribution,
    getCategoryInfo,
    getAllCategories
};
