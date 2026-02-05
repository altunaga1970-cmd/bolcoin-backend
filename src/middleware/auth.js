const { verifyToken, extractToken } = require('../config/auth');
const { ERROR_MESSAGES, USER_ROLES } = require('../config/constants');
const User = require('../models/User');

// =================================
// MIDDLEWARE DE AUTENTICACIÓN
// =================================

/**
 * Middleware para verificar que el usuario está autenticado
 */
async function authenticate(req, res, next) {
    try {
        // Extraer token del header Authorization
        const authHeader = req.headers.authorization;
        const token = extractToken(authHeader);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.UNAUTHORIZED
            });
        }

        // Verificar y decodificar token
        let decoded;
        try {
            decoded = verifyToken(token);
        } catch (error) {
            return res.status(401).json({
                success: false,
                message: error.message
            });
        }

        // Verificar que el usuario existe y está activo
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                message: 'Usuario desactivado'
            });
        }

        // Agregar usuario al request
        req.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role
        };

        next();

    } catch (error) {
        console.error('Error en middleware de autenticación:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Middleware para verificar que el usuario es administrador
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: ERROR_MESSAGES.UNAUTHORIZED
        });
    }

    if (req.user.role !== USER_ROLES.ADMIN) {
        return res.status(403).json({
            success: false,
            message: ERROR_MESSAGES.FORBIDDEN
        });
    }

    next();
}

/**
 * Middleware opcional de autenticación
 * Si hay token, lo verifica y agrega el usuario al request
 * Si no hay token, continúa sin error
 */
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        const token = extractToken(authHeader);

        if (token) {
            try {
                const decoded = verifyToken(token);
                const user = await User.findById(decoded.id);

                if (user && user.is_active) {
                    req.user = {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        role: user.role
                    };
                }
            } catch (error) {
                // Ignorar errores de token en autenticación opcional
                console.log('Token inválido en autenticación opcional');
            }
        }

        next();

    } catch (error) {
        console.error('Error en middleware de autenticación opcional:', error);
        next();
    }
}

module.exports = {
    authenticate,
    requireAdmin,
    optionalAuth
};
