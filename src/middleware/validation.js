const { body, param, query, validationResult } = require('express-validator');
const { GAME_RULES, LIMITS } = require('../config/constants');

// =================================
// MIDDLEWARE DE VALIDACIÓN
// =================================

/**
 * Maneja los resultados de la validación
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Errores de validación',
            errors: errors.array()
        });
    }

    next();
}

// =================================
// VALIDACIONES PARA AUTENTICACIÓN
// =================================

const validateRegister = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('El nombre de usuario debe tener entre 3 y 50 caracteres')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('El nombre de usuario solo puede contener letras, números y guiones bajos'),
    body('email')
        .trim()
        .isEmail()
        .withMessage('Debe proporcionar un email válido')
        .normalizeEmail(),
    body('password')
        .isLength({ min: 6 })
        .withMessage('La contraseña debe tener al menos 6 caracteres'),
    handleValidationErrors
];

const validateLogin = [
    body('username')
        .trim()
        .notEmpty()
        .withMessage('El nombre de usuario es requerido'),
    body('password')
        .notEmpty()
        .withMessage('La contraseña es requerida'),
    handleValidationErrors
];

// =================================
// VALIDACIONES PARA APUESTAS
// =================================

const validatePlaceBet = [
    body('draw_id')
        .isInt({ min: 1 })
        .withMessage('ID de sorteo inválido'),
    body('bets')
        .isArray({ min: 1, max: LIMITS.MAX_BETS_PER_REQUEST })
        .withMessage(`Debe proporcionar entre 1 y ${LIMITS.MAX_BETS_PER_REQUEST} apuestas`),
    body('bets.*.game_type')
        .isIn(['fijos', 'centenas', 'parles', 'corrido'])
        .withMessage('Tipo de juego inválido'),
    body('bets.*.number')
        .notEmpty()
        .withMessage('El número es requerido')
        .isNumeric()
        .withMessage('El número debe ser numérico'),
    body('bets.*.amount')
        .isFloat({ min: LIMITS.MIN_BET_AMOUNT, max: LIMITS.MAX_BET_AMOUNT })
        .withMessage(`El monto debe estar entre ${LIMITS.MIN_BET_AMOUNT} y ${LIMITS.MAX_BET_AMOUNT} USDT`),
    handleValidationErrors
];

// =================================
// VALIDACIONES PARA WALLET
// =================================

const validateRecharge = [
    body('amount')
        .isFloat({ min: LIMITS.MIN_RECHARGE_AMOUNT, max: LIMITS.MAX_RECHARGE_AMOUNT })
        .withMessage(`El monto debe estar entre ${LIMITS.MIN_RECHARGE_AMOUNT} y ${LIMITS.MAX_RECHARGE_AMOUNT} USDT`),
    handleValidationErrors
];

// =================================
// VALIDACIONES PARA SORTEOS
// =================================

const validateCreateDraw = [
    body('draw_number')
        .trim()
        .notEmpty()
        .withMessage('El número de sorteo es requerido')
        .isLength({ max: 50 })
        .withMessage('El número de sorteo no puede exceder 50 caracteres'),
    body('scheduled_time')
        .notEmpty()
        .withMessage('La hora programada es requerida')
        .isISO8601()
        .withMessage('Formato de fecha inválido')
        .custom((value) => {
            const date = new Date(value);
            if (date <= new Date()) {
                throw new Error('La hora programada debe ser en el futuro');
            }
            return true;
        }),
    handleValidationErrors
];

const validateEnterResults = [
    param('id')
        .isInt({ min: 1 })
        .withMessage('ID de sorteo inválido'),
    body('winning_number')
        .trim()
        .matches(/^\d{4}$/)
        .withMessage('El número ganador debe ser de 4 dígitos'),
    handleValidationErrors
];

// =================================
// VALIDACIONES PARA ADMINISTRACIÓN
// =================================

const validateUserId = [
    param('id')
        .isInt({ min: 1 })
        .withMessage('ID de usuario inválido'),
    handleValidationErrors
];

const validateAdjustBalance = [
    param('id')
        .isInt({ min: 1 })
        .withMessage('ID de usuario inválido'),
    body('amount')
        .isFloat()
        .withMessage('El monto debe ser un número')
        .custom((value) => {
            if (value === 0) {
                throw new Error('El monto no puede ser cero');
            }
            return true;
        }),
    body('reason')
        .trim()
        .notEmpty()
        .withMessage('La razón es requerida')
        .isLength({ max: 255 })
        .withMessage('La razón no puede exceder 255 caracteres'),
    handleValidationErrors
];

// =================================
// VALIDACIONES PARA PAGINACIÓN
// =================================

const validatePagination = [
    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('La página debe ser un número entero positivo'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('El límite debe estar entre 1 y 100'),
    handleValidationErrors
];

module.exports = {
    handleValidationErrors,
    validateRegister,
    validateLogin,
    validatePlaceBet,
    validateRecharge,
    validateCreateDraw,
    validateEnterResults,
    validateUserId,
    validateAdjustBalance,
    validatePagination
};
