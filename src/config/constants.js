// =================================
// REGLAS DEL JUEGO - LA BOLITA
// =================================

const GAME_RULES = {
    fijos: {
        name: 'Fijos',
        nameEn: 'Fixed',
        description: '2-digit bet (00-99)',
        descriptionEs: 'Apuesta de 2 dígitos (00-99)',
        digits: 2,
        min: 0,
        max: 99,
        totalNumbers: 100,  // 100 números únicos
        multiplier: 65,
        multiplierBps: 6500,  // 65x in basis points (65 * 100)
        maxBet: 1000,
        minBet: 1,
        format: (n) => String(n).padStart(2, '0')  // "5" → "05"
    },
    centenas: {
        name: 'Centenas',
        nameEn: 'Hundreds',
        description: '3-digit bet (100-999)',
        descriptionEs: 'Apuesta de 3 dígitos (100-999)',
        digits: 3,
        min: 100,
        max: 999,
        totalNumbers: 900,  // 900 números únicos
        multiplier: 300,
        multiplierBps: 30000,  // 300x in basis points
        maxBet: 1000,
        minBet: 1,
        format: (n) => String(n)  // "123" → "123"
    },
    parles: {
        name: 'Parles',
        nameEn: 'Parlays',
        description: '4-digit bet (1000-9999)',
        descriptionEs: 'Apuesta de 4 dígitos (1000-9999)',
        digits: 4,
        min: 1000,
        max: 9999,
        totalNumbers: 9000,  // 9000 números únicos
        multiplier: 1000,
        multiplierBps: 100000,  // 1000x in basis points
        maxBet: 1000,
        minBet: 1,
        format: (n) => String(n)  // "1234" → "1234"
    },
    corrido: {
        name: 'Corrido',
        nameEn: 'Running',
        description: '4-digit bet that creates two Fijos bets (first 2 and last 2)',
        descriptionEs: 'Apuesta de 4 dígitos que crea dos apuestas Fijos (primeros 2 y últimos 2)',
        digits: 4,
        min: 0,
        max: 9999,
        multiplier: 30,
        multiplierBps: 3000,
        maxBet: 1000,
        minBet: 1,
        cost_multiplier: 2
    }
};

// =================================
// REGLAS DEL JUEGO - LA FORTUNA (LOTTERY)
// =================================

const LOTTERY_RULES = {
    name: 'La Fortuna',
    description: 'Pick 6 numbers from 1-49 plus a key number from 0-9',
    descriptionEs: 'Elige 6 números del 1-49 más un número clave del 0-9',

    // Number selection rules
    mainNumbers: {
        count: 6,        // Pick 6 numbers
        min: 1,
        max: 49,
        unique: true     // Must be unique
    },
    keyNumber: {
        min: 0,
        max: 9
    },

    // Ticket pricing
    ticketPrice: 1,      // 1 USDT per bet/line
    maxTicketsPerTx: 8,  // Max bets per ticket

    // Draw schedule
    drawDays: ['wednesday', 'saturday'],
    drawTimeUTC: '21:00', // 21:00 UTC

    // Prize categories (5 categories)
    // La clave SOLO importa para el Jackpot
    // Category 1: 6 + key = Jackpot (20% acumulado)
    // Category 2: 6 numbers = 40% del total
    // Category 3: 5 numbers = 5% del total
    // Category 4: 4 numbers = 3% del total
    // Category 5: 3 numbers = 6% del total
    prizeCategories: 5
};

// =================================
// PRIZE CONFIGURATION - LA FORTUNA
// Sistema unificado de premios
// =================================

const LOTTERY_PRIZES = {
    // Jackpot configuration
    jackpot: {
        cap: 1000000,           // $1,000,000 USDT cap
        minStart: 0,            // Jackpot inicia en 0
        contributionBps: 2000,  // 20% de cada venta va al jackpot
        overflowTarget: 'reserve'  // Si alcanza el cap, va a reservas
    },

    // 5 categorías de premio (simplificado)
    // Cat 1: 6+clave = Jackpot progresivo
    // Cat 2-5: Solo importan los aciertos, no la clave
    categories: {
        1: {
            matches: 6,
            keyMatch: true,
            prize: 'jackpot',
            prizeBps: 2000,
            description: '6 numbers + key (Jackpot)',
            descriptionEs: '6 aciertos + clave (Jackpot)'
        },
        2: {
            matches: 6,
            keyMatch: false,
            prize: 'pool',
            prizeBps: 4000,
            description: '6 numbers (40% of pool)',
            descriptionEs: '6 aciertos (40% del total)'
        },
        3: {
            matches: 5,
            keyMatch: null,
            prize: 'pool',
            prizeBps: 500,
            description: '5 numbers (5% of pool)',
            descriptionEs: '5 aciertos (5% del total)'
        },
        4: {
            matches: 4,
            keyMatch: null,
            prize: 'pool',
            prizeBps: 300,
            description: '4 numbers (3% of pool)',
            descriptionEs: '4 aciertos (3% del total)'
        },
        5: {
            matches: 3,
            keyMatch: null,
            prize: 'pool',
            prizeBps: 600,
            description: '3 numbers (6% of pool)',
            descriptionEs: '3 aciertos (6% del total)'
        }
    },

    // Distribución del total recaudado (en BPS, total = 10000)
    distribution: {
        jackpotBps: 2000,     // 20% al jackpot progresivo
        cat6Bps: 4000,        // 40% a 6 aciertos
        cat5Bps: 500,         // 5% a 5 aciertos
        cat4Bps: 300,         // 3% a 4 aciertos
        cat3Bps: 600,         // 6% a 3 aciertos
        operatorBps: 600,     // 6% fee operador
        reserveBps: 2000      // 20% a reservas
        // Total: 2000+4000+500+300+600+600+2000 = 10000 (100%)
    }
};

// =================================
// PRIZE CONFIGURATION - LA BOLITA
// =================================

const BOLITA_PRIZES = {
    // Multiplicadores de premio
    multipliers: {
        fijos: 65,      // 65x
        centenas: 300,  // 300x
        parles: 1000    // 1000x
    },

    // Distribución del pool CUANDO HAY GANADOR (total = 100%)
    distributionWithWinner: {
        feeBps: 500,           // 5% fee operador
        reserveBps: 6500,      // 65% a reserva de premios
        bankrollBps: 3000      // 30% a bankroll (aumentar límite)
    },

    // Distribución del pool CUANDO NO HAY GANADOR (total = 100%)
    distributionNoWinner: {
        feeBps: 500,           // 5% fee operador
        reserveBps: 4500,      // 45% a reserva de premios
        bankrollBps: 5000      // 50% a bankroll (aumentar límite más rápido)
    },

    // Sistema de límites por número
    numberLimits: {
        initialLimit: 2,       // 2 USDT inicial por número
        maxLimit: 1000,        // 1000 USDT máximo por número
        minLimit: 2            // Mínimo siempre 2 USDT
    },

    // Capital inicial requerido
    initialReserve: 1000       // 1000 USDT reserva inicial para empezar
};

// =================================
// ESTADOS DE SORTEO
// =================================

const DRAW_STATUS = {
    SCHEDULED: 'scheduled',  // Programado, aún no abierto para apuestas
    OPEN: 'open',            // Abierto para apuestas
    CLOSED: 'closed',        // Cerrado, esperando resultados
    COMPLETED: 'completed',  // Completado con resultados ingresados
    CANCELLED: 'cancelled'   // Cancelado
};

// =================================
// ESTADOS DE APUESTA
// =================================

const BET_STATUS = {
    PENDING: 'pending',      // Esperando resultado del sorteo
    WON: 'won',             // Ganó
    LOST: 'lost',           // Perdió
    CANCELLED: 'cancelled',  // Cancelado
    REFUNDED: 'refunded'    // Reembolsado
};

// =================================
// TIPOS DE TRANSACCIÓN
// =================================

const TRANSACTION_TYPE = {
    RECHARGE: 'recharge',        // Recarga de balance
    BET: 'bet',                  // Apuesta realizada
    WIN: 'win',                  // Ganancia de apuesta
    REFUND: 'refund',           // Reembolso
    ADJUSTMENT: 'adjustment'     // Ajuste manual por admin
};

// =================================
// ROLES DE USUARIO
// =================================

const USER_ROLES = {
    USER: 'user',
    ADMIN: 'admin'
};

// =================================
// LÍMITES Y CONFIGURACIONES
// =================================

const LIMITS = {
    MAX_BET_AMOUNT: 1000,           // Máximo por apuesta en USDT
    MIN_BET_AMOUNT: 1,              // Mínimo por apuesta en USDT
    MAX_BETS_PER_REQUEST: 50,       // Máximo de apuestas en una solicitud
    MAX_BALANCE: 999999999.99,      // Balance máximo permitido
    MIN_RECHARGE_AMOUNT: 1,         // Mínimo para recarga
    MAX_RECHARGE_AMOUNT: 100000     // Máximo para recarga
};

// =================================
// MENSAJES DE ERROR
// =================================

const ERROR_MESSAGES = {
    // Autenticación
    INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos',
    USER_NOT_FOUND: 'Usuario no encontrado',
    EMAIL_EXISTS: 'El correo electrónico ya está registrado',
    USERNAME_EXISTS: 'El nombre de usuario ya está en uso',
    UNAUTHORIZED: 'No autorizado',
    TOKEN_EXPIRED: 'Token expirado',
    INVALID_TOKEN: 'Token inválido',

    // Apuestas
    INSUFFICIENT_BALANCE: 'Balance insuficiente',
    INVALID_BET_AMOUNT: 'Monto de apuesta inválido',
    BET_AMOUNT_TOO_HIGH: `Monto máximo de apuesta es ${LIMITS.MAX_BET_AMOUNT} USDT`,
    BET_AMOUNT_TOO_LOW: `Monto mínimo de apuesta es ${LIMITS.MIN_BET_AMOUNT} USDT`,
    INVALID_NUMBER: 'Número inválido para este tipo de juego',
    DRAW_NOT_OPEN: 'El sorteo no está abierto para apuestas',
    DRAW_NOT_FOUND: 'Sorteo no encontrado',

    // Transacciones
    INVALID_RECHARGE_AMOUNT: 'Monto de recarga inválido',
    RECHARGE_TOO_LOW: `Recarga mínima es ${LIMITS.MIN_RECHARGE_AMOUNT} USDT`,
    RECHARGE_TOO_HIGH: `Recarga máxima es ${LIMITS.MAX_RECHARGE_AMOUNT} USDT`,

    // General
    SERVER_ERROR: 'Error del servidor',
    VALIDATION_ERROR: 'Error de validación',
    NOT_FOUND: 'Recurso no encontrado',
    FORBIDDEN: 'Acceso prohibido'
};

// =================================
// MENSAJES DE ÉXITO
// =================================

const SUCCESS_MESSAGES = {
    REGISTER_SUCCESS: 'Usuario registrado exitosamente',
    LOGIN_SUCCESS: 'Inicio de sesión exitoso',
    BET_PLACED: 'Apuesta realizada exitosamente',
    RECHARGE_SUCCESS: 'Recarga realizada exitosamente',
    DRAW_CREATED: 'Sorteo creado exitosamente',
    RESULTS_ENTERED: 'Resultados ingresados y pagos procesados',
    UPDATE_SUCCESS: 'Actualización exitosa'
};

// =================================
// OPCIONES RÁPIDAS DE RECARGA
// =================================

const QUICK_RECHARGE_OPTIONS = [1, 5, 10, 50, 100, 1000];

// =================================
// CONFIGURACIÓN DE JWT
// =================================

const JWT_CONFIG = {
    EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h',
    ALGORITHM: 'HS256'
};

// =================================
// CONFIGURACIÓN DE BCRYPT
// =================================

const BCRYPT_CONFIG = {
    SALT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 10
};

// =================================
// OPERATOR WALLET CONFIGURATION
// =================================

const OPERATOR_CONFIG = {
    // Wallet address for receiving operator fees
    WALLET_ADDRESS: process.env.OPERATOR_WALLET || '0xF52616a91Ff9368D5A25186D179Bf33D505bE520',

    // Fee percentages (in basis points, 10000 = 100%)
    BOLITA_FEE_BPS: 500,     // 5% of La Bolita pool
    FORTUNA_FEE_BPS: 600,    // 6% of La Fortuna pool

    // Auto-transfer settings
    AUTO_TRANSFER_ENABLED: process.env.OPERATOR_AUTO_TRANSFER === 'true',
    MIN_TRANSFER_AMOUNT: 10  // Minimum amount to trigger transfer (USDT)
};

// =================================
// RISK MANAGEMENT CONFIGURATION
// =================================

const RISK_CONFIG = {
    // Bankroll Management (in basis points where 10000 = 100%)
    RESERVE_RATIO_BPS: 3000,        // 30% del pool en reserva
    RISK_FACTOR_BPS: 1000,          // 10% del usable para riesgo diario
    ABSOLUTE_MAX_PAYOUT: 10000,     // 10,000 USDT max payout absoluto

    // Operator Commission
    OPERATOR_COMMISSION_BPS: 1500,  // 15% comision sobre beneficio neto positivo

    // Stake Limits (in USDT)
    MIN_STAKE: 1,                   // 1 USDT minimo
    MAX_STAKE: 10,                  // 10 USDT maximo

    // New Multipliers for Risk-Managed Contract
    MULTIPLIERS: {
        FIJO: 65,                   // 65x
        FIJO_BPS: 650000,           // 65 * 10000
        CENTENA: 300,               // 300x
        CENTENA_BPS: 3000000,       // 300 * 10000
        PARLE: 1000,                // 1000x
        PARLE_BPS: 10000000         // 1000 * 10000
    },

    // Exposure Alert Thresholds (percentage of payout cap)
    ALERT_THRESHOLDS: {
        WARNING: 70,                // 70% - mostrar advertencia
        CRITICAL: 90,               // 90% - alerta critica
        BLOCKED: 100                // 100% - bloquear apuestas
    },

    // Settlement Configuration
    SETTLEMENT: {
        AUTO_SETTLE_DELAY_HOURS: 2, // Horas despues del ultimo sorteo para liquidar
        COMMISSION_DAY: 1           // Dia del mes para calcular comision mensual
    }
};

// Helper function to calculate payout cap
function calculatePayoutCap(totalPool) {
    const reserveAmount = (totalPool * RISK_CONFIG.RESERVE_RATIO_BPS) / 10000;
    const usableBalance = totalPool - reserveAmount;
    const riskBased = (usableBalance * RISK_CONFIG.RISK_FACTOR_BPS) / 10000;
    return Math.min(riskBased, RISK_CONFIG.ABSOLUTE_MAX_PAYOUT);
}

// Helper function to calculate potential liability
function calculateLiability(betType, stake) {
    const multipliers = RISK_CONFIG.MULTIPLIERS;
    switch(betType.toLowerCase()) {
        case 'fijo':
        case 'fijos':
            return stake * multipliers.FIJO;
        case 'centena':
        case 'centenas':
            return stake * multipliers.CENTENA;
        case 'parle':
        case 'parles':
            return stake * multipliers.PARLE;
        default:
            return 0;
    }
}

// Helper function to check if bet can be placed
function canPlaceBet(currentLiability, newLiability, payoutCap) {
    return (currentLiability + newLiability) <= payoutCap;
}

// =================================
// CONFIGURACIÓN VRF (Chainlink)
// =================================

const VRF_CONFIG = {
    // Polygon Mainnet VRF Coordinator
    COORDINATOR_ADDRESS: process.env.VRF_COORDINATOR || '0xAE975071Be8F8eE67addBC1A82488F1C24858067',
    // Subscription ID
    SUBSCRIPTION_ID: process.env.VRF_SUBSCRIPTION_ID || '',
    // Key hash (gas lane)
    KEY_HASH: process.env.VRF_KEY_HASH || '0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd',
    // Callback gas limit
    CALLBACK_GAS_LIMIT: parseInt(process.env.VRF_CALLBACK_GAS_LIMIT) || 500000,
    // Request confirmations
    REQUEST_CONFIRMATIONS: parseInt(process.env.VRF_REQUEST_CONFIRMATIONS) || 3,
    // Number of random words needed
    NUM_WORDS: 1
};

// =================================
// CONFIGURACIÓN DEL SCHEDULER
// =================================

const SCHEDULER_CONFIG = {
    // Horarios de sorteo de La Bolita (UTC) - 10:00, 15:00, 21:00 (Morning, Afternoon, Night)
    BOLITA_DRAW_TIMES: ['10:00', '15:00', '21:00'],

    // Días de sorteo de La Fortuna
    LOTTERY_DRAW_DAYS: [3, 6], // 0=domingo, 3=miércoles, 6=sábado
    LOTTERY_DRAW_TIME: '21:00', // 21:00 UTC

    // Minutos antes del sorteo para cerrar apuestas
    CLOSE_BEFORE_DRAW_MINUTES: 5,

    // Minutos después del cierre para solicitar VRF
    VRF_REQUEST_DELAY_MINUTES: 1,

    // Tiempo máximo de espera para VRF (minutos)
    VRF_TIMEOUT_MINUTES: 10,

    // Período de claims para La Fortuna (días)
    CLAIMS_PERIOD_DAYS: 30,

    // Intervalo de verificación del scheduler (ms)
    CHECK_INTERVAL_MS: 60000, // 1 minuto

    // Auto-crear sorteos con anticipación (horas)
    AUTO_CREATE_AHEAD_HOURS: 24
};

// =================================
// TIPOS DE AUDIT LOG
// =================================

const AUDIT_ACTIONS = {
    // Sorteos
    DRAW_CREATED: 'draw_created',
    DRAW_OPENED: 'draw_opened',
    DRAW_CLOSED: 'draw_closed',
    DRAW_VRF_REQUESTED: 'draw_vrf_requested',
    DRAW_VRF_FULFILLED: 'draw_vrf_fulfilled',
    DRAW_SETTLED: 'draw_settled',
    DRAW_COMPLETED: 'draw_completed',
    DRAW_CANCELLED: 'draw_cancelled',

    // Admin
    ADMIN_LOGIN: 'admin_login',
    CONFIG_CHANGED: 'config_changed',
    MANUAL_OVERRIDE: 'manual_override',

    // Pagos
    PAYOUT_PROCESSED: 'payout_processed',
    MERKLE_ROOT_PUBLISHED: 'merkle_root_published',
    CLAIM_PROCESSED: 'claim_processed',

    // Sistema
    SCHEDULER_STARTED: 'scheduler_started',
    SCHEDULER_STOPPED: 'scheduler_stopped',
    VRF_ERROR: 'vrf_error',
    SYSTEM_ERROR: 'system_error',

    // Keno
    KENO_SESSION_SETTLED: 'keno_session_settled',
    KENO_SESSION_AUTO_SETTLED: 'keno_session_auto_settled',
    KENO_POOL_LOW: 'keno_pool_low',
    KENO_POOL_CRITICAL: 'keno_pool_critical',
    KENO_VRF_BATCH_CREATED: 'keno_vrf_batch_created',
    KENO_VRF_BATCH_VERIFIED: 'keno_vrf_batch_verified',
    KENO_VRF_BATCH_FAILED: 'keno_vrf_batch_failed'
};

// =================================
// FUNCIONES ÚTILES
// =================================

/**
 * Valida si un número está dentro del rango permitido para un tipo de juego
 */
function isValidNumber(gameType, number) {
    const rules = GAME_RULES[gameType];
    if (!rules) return false;

    // Convertir a número
    const num = parseInt(number, 10);

    // Verificar rango
    if (num < rules.min || num > rules.max) return false;

    // Verificar longitud de dígitos (con ceros iniciales)
    const paddedNumber = number.toString().padStart(rules.digits, '0');
    if (paddedNumber.length !== rules.digits) return false;

    return true;
}

/**
 * Formatea un número con ceros iniciales según el tipo de juego
 */
function formatNumber(gameType, number) {
    const rules = GAME_RULES[gameType];
    if (!rules) return number;

    return number.toString().padStart(rules.digits, '0');
}

/**
 * Extrae los números ganadores de un número de 4 dígitos
 * El VRF genera un número de 4 dígitos (1000-9999)
 * De ahí se extraen los ganadores para cada tipo
 */
function extractWinningNumbers(winningNumber) {
    // winningNumber es un número de 4 dígitos: "1234" o "5678"
    const num = parseInt(winningNumber, 10);

    return {
        parles: winningNumber,                           // "1234" → Parle ganador
        centenas: String(num % 1000),                    // 1234 % 1000 = 234 → Centena ganadora
        fijos: String(num % 100).padStart(2, '0')        // 1234 % 100 = 34 → "34" Fijo ganador
    };
}

/**
 * Determina el tipo de juego basado en el valor del número
 * @param {string|number} number - El número apostado
 * @returns {string|null} - 'fijos', 'centenas', 'parles' o null si es inválido
 */
function getGameTypeFromNumber(number) {
    const num = parseInt(number, 10);

    if (isNaN(num) || num < 0) return null;

    if (num >= 0 && num <= 99) return 'fijos';        // 00-99: 100 números
    if (num >= 100 && num <= 999) return 'centenas';  // 100-999: 900 números
    if (num >= 1000 && num <= 9999) return 'parles';  // 1000-9999: 9000 números

    return null;
}

/**
 * Valida que el número coincida con el tipo de juego especificado
 * @param {string} gameType - Tipo de juego
 * @param {string|number} number - Número apostado
 * @returns {boolean}
 */
function validateNumberForGameType(gameType, number) {
    const expectedType = getGameTypeFromNumber(number);
    return expectedType === gameType;
}

/**
 * Formatea el número para mostrar según su tipo
 * @param {string|number} number - Número
 * @returns {string} - Número formateado
 */
function formatBetNumber(number) {
    const num = parseInt(number, 10);
    const gameType = getGameTypeFromNumber(num);

    if (gameType === 'fijos') {
        return String(num).padStart(2, '0');  // "5" → "05"
    }
    return String(num);  // "123" → "123", "1234" → "1234"
}

// =================================
// DRAW STATE MACHINE
// =================================

const DRAW_STATE_MACHINE = {
    // La Bolita draw states
    bolita: {
        OPEN: 'open',                    // Accepting bets
        CLOSED: 'closed',                // Betting closed, awaiting VRF
        VRF_REQUESTED: 'vrf_requested',  // VRF request sent
        VRF_FULFILLED: 'vrf_fulfilled',  // VRF received, results available
        SETTLED: 'settled',              // Winners calculated
        COMPLETED: 'completed'           // All done
    },

    // La Fortuna lottery states
    lottery: {
        OPEN: 'open',                          // Selling tickets
        CLOSED: 'closed',                      // Sales closed, awaiting VRF
        VRF_REQUESTED: 'vrf_requested',        // VRF request sent
        VRF_FULFILLED: 'vrf_fulfilled',        // VRF received, results available
        SETTLED: 'settled',                    // Winners calculated
        ROOTS_PUBLISHED: 'roots_published',    // Merkle roots published
        CLAIMS_OPEN: 'claims_open',            // Claims period started
        COMPLETED: 'completed'                 // All done, claims period ended
    },

    // Allowed transitions
    transitions: {
        open: ['closed'],
        closed: ['vrf_requested'],
        vrf_requested: ['vrf_fulfilled'],
        vrf_fulfilled: ['settled'],
        settled: ['roots_published', 'completed'],
        roots_published: ['claims_open'],
        claims_open: ['completed']
    }
};

// =================================
// LOTTERY VALIDATION HELPERS
// =================================

/**
 * Validate lottery numbers (6 numbers 1-49, key 0-9)
 */
function validateLotteryNumbers(numbers, keyNumber) {
    // Check array length
    if (!Array.isArray(numbers) || numbers.length !== 6) {
        return { valid: false, error: 'Must select exactly 6 numbers' };
    }

    // Check each number is in valid range
    for (const num of numbers) {
        if (typeof num !== 'number' || num < 1 || num > 49 || !Number.isInteger(num)) {
            return { valid: false, error: 'Numbers must be integers from 1 to 49' };
        }
    }

    // Check for duplicates
    const uniqueNums = new Set(numbers);
    if (uniqueNums.size !== 6) {
        return { valid: false, error: 'Numbers must be unique' };
    }

    // Check key number
    if (typeof keyNumber !== 'number' || keyNumber < 0 || keyNumber > 9 || !Number.isInteger(keyNumber)) {
        return { valid: false, error: 'Key number must be an integer from 0 to 9' };
    }

    return { valid: true };
}

/**
 * Calculate lottery prize category based on matches
 * Sistema simplificado de 5 categorías:
 * - Cat 1: 6 + clave = Jackpot
 * - Cat 2: 6 aciertos (sin clave) = 40% del total
 * - Cat 3: 5 aciertos = 5% del total
 * - Cat 4: 4 aciertos = 3% del total
 * - Cat 5: 3 aciertos = 6% del total
 *
 * La clave solo importa para el Jackpot (6+clave)
 */
function calculateLotteryCategory(ticketNumbers, ticketKey, winningNumbers, winningKey) {
    // Count main number matches
    const matches = ticketNumbers.filter(num => winningNumbers.includes(num)).length;
    const keyMatch = ticketKey === winningKey;

    // Determine category based on matches
    if (matches === 6 && keyMatch) return 1;   // Jackpot (6 + clave)
    if (matches === 6) return 2;               // 6 aciertos (40%)
    if (matches === 5) return 3;               // 5 aciertos (5%)
    if (matches === 4) return 4;               // 4 aciertos (3%)
    if (matches === 3) return 5;               // 3 aciertos (6%)

    return 0;  // No prize (menos de 3 aciertos)
}

/**
 * Get prize BPS for a lottery category
 * El premio real se calcula: (totalRecaudado * prizeBps) / 10000 / numGanadores
 *
 * @param {number} category - Categoría (1-5)
 * @param {number} currentJackpot - Jackpot actual (solo para cat 1)
 * @param {number} totalPool - Total recaudado en el sorteo (opcional)
 * @param {number} winnersInCategory - Número de ganadores en la categoría (opcional)
 * @returns {number} Premio por ganador o BPS si no se pasa totalPool
 */
function getLotteryPrize(category, currentJackpot, totalPool = null, winnersInCategory = 1) {
    if (category === 0) return 0;
    if (category === 1) return currentJackpot; // Jackpot

    const prizeConfig = LOTTERY_PRIZES.categories[category];
    if (!prizeConfig) return 0;

    // Si no se pasa el pool, devolver los BPS para cálculo posterior
    if (totalPool === null) {
        return prizeConfig.prizeBps;
    }

    // Calcular premio real: (total * BPS) / 10000 / ganadores
    const categoryPool = (totalPool * prizeConfig.prizeBps) / 10000;
    return winnersInCategory > 0 ? categoryPool / winnersInCategory : categoryPool;
}

/**
 * Calculate jackpot contribution from ticket sale
 * 20% de cada venta va al jackpot (contributionBps = 2000)
 */
function calculateJackpotContribution(ticketPrice, currentJackpot) {
    const contribution = (ticketPrice * LOTTERY_PRIZES.jackpot.contributionBps) / 10000;

    // Check if jackpot cap would be exceeded ($1M)
    if (currentJackpot + contribution > LOTTERY_PRIZES.jackpot.cap) {
        const toJackpot = Math.max(0, LOTTERY_PRIZES.jackpot.cap - currentJackpot);
        const overflow = contribution - toJackpot;
        return { toJackpot, overflow, capped: true };
    }

    return { toJackpot: contribution, overflow: 0, capped: false };
}

// =================================
// EXPORTACIONES
// =================================

module.exports = {
    // Game rules
    GAME_RULES,
    LOTTERY_RULES,

    // Prize configurations
    LOTTERY_PRIZES,
    BOLITA_PRIZES,

    // States
    DRAW_STATUS,
    BET_STATUS,
    TRANSACTION_TYPE,
    USER_ROLES,
    DRAW_STATE_MACHINE,

    // Limits and config
    LIMITS,
    ERROR_MESSAGES,
    SUCCESS_MESSAGES,
    QUICK_RECHARGE_OPTIONS,
    JWT_CONFIG,
    BCRYPT_CONFIG,

    // VRF, Scheduler and Operator
    VRF_CONFIG,
    SCHEDULER_CONFIG,
    AUDIT_ACTIONS,
    OPERATOR_CONFIG,

    // Risk Management
    RISK_CONFIG,

    // Functions
    isValidNumber,
    formatNumber,
    extractWinningNumbers,
    validateLotteryNumbers,
    calculateLotteryCategory,
    getLotteryPrize,
    calculateJackpotContribution,
    getGameTypeFromNumber,
    validateNumberForGameType,
    formatBetNumber,

    // Risk Management Functions
    calculatePayoutCap,
    calculateLiability,
    canPlaceBet
};
