const jwt = require('jsonwebtoken');
require('dotenv').config();

// =================================
// CONFIGURACIÓN DE JWT
// =================================

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const JWT_ADMIN_EXPIRES_IN = process.env.JWT_ADMIN_EXPIRES_IN || '4h';

// Validar que en produccion no se use el secret por defecto
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'default-secret-key-change-in-production') {
    console.error('[FATAL] JWT_SECRET no configurado en produccion. Saliendo.');
    process.exit(1);
}

// =================================
// FUNCIONES DE JWT
// =================================

/**
 * Genera un token JWT para un usuario
 * @param {Object} user - Objeto del usuario
 * @returns {String} Token JWT
 */
function generateToken(payload) {
    // Admin JWT: payload tiene type:'admin'
    if (payload.type === 'admin') {
        return jwt.sign(payload, JWT_SECRET, {
            expiresIn: JWT_ADMIN_EXPIRES_IN,
            algorithm: 'HS256'
        });
    }

    // User JWT (legacy): payload es un objeto user con id, username, etc.
    const userPayload = {
        id: payload.id,
        username: payload.username,
        email: payload.email,
        role: payload.role
    };

    return jwt.sign(userPayload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
        algorithm: 'HS256'
    });
}

/**
 * Verifica y decodifica un token JWT
 * @param {String} token - Token JWT
 * @returns {Object} Payload decodificado
 * @throws {Error} Si el token es inválido
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            throw new Error('Token expirado');
        } else if (error.name === 'JsonWebTokenError') {
            throw new Error('Token inválido');
        } else {
            throw new Error('Error verificando token');
        }
    }
}

/**
 * Decodifica un token sin verificar (útil para debugging)
 * @param {String} token - Token JWT
 * @returns {Object} Payload decodificado
 */
function decodeToken(token) {
    return jwt.decode(token);
}

/**
 * Extrae el token del header Authorization
 * @param {String} authHeader - Header Authorization
 * @returns {String|null} Token extraído o null
 */
function extractToken(authHeader) {
    if (!authHeader) return null;

    // El formato esperado es: "Bearer <token>"
    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return null;
    }

    return parts[1];
}

// =================================
// EXPORTACIONES
// =================================

module.exports = {
    JWT_EXPIRES_IN,
    JWT_ADMIN_EXPIRES_IN,
    generateToken,
    verifyToken,
    decodeToken,
    extractToken
};
