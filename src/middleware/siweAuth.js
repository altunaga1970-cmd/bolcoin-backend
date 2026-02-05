const { ethers } = require('ethers');
const crypto = require('crypto');
const { isAdminWallet, getAdminRole, hasPermission, ADMIN_ROLES } = require('../config/adminWallets');
const { ERROR_MESSAGES, AUDIT_ACTIONS } = require('../config/constants');
const AuditLog = require('../models/AuditLog');

// =================================
// SIWE (Sign-In With Ethereum) AUTH
// =================================

/**
 * Store para nonces (en producción usar Redis)
 */
const nonceStore = new Map();

/**
 * Store para sesiones admin (en producción usar Redis/JWT)
 */
const sessionStore = new Map();

/**
 * Configuración SIWE
 */
const SIWE_CONFIG = {
    NONCE_EXPIRY_MS: 5 * 60 * 1000,       // 5 minutos para usar el nonce
    SESSION_EXPIRY_MS: 4 * 60 * 60 * 1000, // 4 horas de sesión
    DOMAIN: process.env.SIWE_DOMAIN || 'localhost',
    STATEMENT: 'Iniciar sesion como administrador en La Bolita'
};

/**
 * Generar nonce único
 */
function generateNonce() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Crear mensaje SIWE para firmar
 */
function createSiweMessage(address, nonce, chainId = 137) {
    const issuedAt = new Date().toISOString();
    const expirationTime = new Date(Date.now() + SIWE_CONFIG.NONCE_EXPIRY_MS).toISOString();

    const message = `${SIWE_CONFIG.DOMAIN} quiere que firmes con tu cuenta Ethereum:
${address}

${SIWE_CONFIG.STATEMENT}

URI: https://${SIWE_CONFIG.DOMAIN}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`;

    return message;
}

/**
 * Middleware: Generar nonce para SIWE
 */
async function generateSiweNonce(req, res) {
    try {
        const { address } = req.query;

        if (!address || !ethers.isAddress(address)) {
            return res.status(400).json({
                success: false,
                message: 'Direccion de wallet invalida'
            });
        }

        const normalizedAddress = address.toLowerCase();

        // Verificar si es wallet admin
        if (!isAdminWallet(normalizedAddress)) {
            return res.status(403).json({
                success: false,
                message: 'Esta wallet no tiene permisos de administrador'
            });
        }

        // Generar nonce
        const nonce = generateNonce();
        const chainId = parseInt(process.env.CHAIN_ID || '137');

        // Guardar nonce con expiración
        nonceStore.set(normalizedAddress, {
            nonce,
            createdAt: Date.now(),
            expiresAt: Date.now() + SIWE_CONFIG.NONCE_EXPIRY_MS
        });

        // Crear mensaje para firmar
        const message = createSiweMessage(normalizedAddress, nonce, chainId);

        res.json({
            success: true,
            data: {
                nonce,
                message,
                expiresIn: SIWE_CONFIG.NONCE_EXPIRY_MS / 1000
            }
        });
    } catch (error) {
        console.error('Error generando nonce SIWE:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Middleware: Verificar firma SIWE y crear sesión
 */
async function verifySiweSignature(req, res) {
    try {
        const { address, signature, message } = req.body;

        if (!address || !signature || !message) {
            return res.status(400).json({
                success: false,
                message: 'Faltan parametros: address, signature, message'
            });
        }

        const normalizedAddress = address.toLowerCase();

        // Verificar si es wallet admin
        if (!isAdminWallet(normalizedAddress)) {
            return res.status(403).json({
                success: false,
                message: 'Esta wallet no tiene permisos de administrador'
            });
        }

        // Verificar nonce
        const storedNonce = nonceStore.get(normalizedAddress);
        if (!storedNonce) {
            return res.status(400).json({
                success: false,
                message: 'Nonce no encontrado. Solicita uno nuevo.'
            });
        }

        if (Date.now() > storedNonce.expiresAt) {
            nonceStore.delete(normalizedAddress);
            return res.status(400).json({
                success: false,
                message: 'Nonce expirado. Solicita uno nuevo.'
            });
        }

        // Verificar que el nonce está en el mensaje
        if (!message.includes(storedNonce.nonce)) {
            return res.status(400).json({
                success: false,
                message: 'Nonce invalido en el mensaje'
            });
        }

        // Verificar firma
        let recoveredAddress;
        try {
            recoveredAddress = ethers.verifyMessage(message, signature);
        } catch (error) {
            return res.status(400).json({
                success: false,
                message: 'Firma invalida'
            });
        }

        if (recoveredAddress.toLowerCase() !== normalizedAddress) {
            return res.status(400).json({
                success: false,
                message: 'La firma no corresponde a la wallet'
            });
        }

        // Limpiar nonce usado
        nonceStore.delete(normalizedAddress);

        // Crear sesión
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const role = getAdminRole(normalizedAddress);

        sessionStore.set(sessionToken, {
            address: normalizedAddress,
            role,
            createdAt: Date.now(),
            expiresAt: Date.now() + SIWE_CONFIG.SESSION_EXPIRY_MS,
            ip: req.ip
        });

        // Audit log
        await AuditLog.create({
            action: AUDIT_ACTIONS.ADMIN_LOGIN,
            entity_type: 'admin',
            actor_address: normalizedAddress,
            details: { role, ip: req.ip },
            ip_address: req.ip
        });

        res.json({
            success: true,
            data: {
                token: sessionToken,
                address: normalizedAddress,
                role,
                expiresIn: SIWE_CONFIG.SESSION_EXPIRY_MS / 1000
            }
        });
    } catch (error) {
        console.error('Error verificando SIWE:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Middleware: Verificar sesión admin
 */
function requireAdminSession(req, res, next) {
    try {
        // Buscar token en header o cookie
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.slice(7)
            : req.headers['x-admin-token'];

        console.log(`[AdminAuth] Verificando sesion para ${req.path}`);
        console.log(`[AdminAuth] Token recibido: ${token ? token.substring(0, 20) + '...' : 'NINGUNO'}`);
        console.log(`[AdminAuth] Sesiones activas: ${sessionStore.size}`);

        if (!token) {
            console.log('[AdminAuth] RECHAZADO: No hay token');
            return res.status(401).json({
                success: false,
                message: 'Token de sesion requerido'
            });
        }

        // Verificar sesión
        const session = sessionStore.get(token);

        if (!session) {
            console.log('[AdminAuth] RECHAZADO: Sesion no encontrada (servidor reiniciado?)');
            return res.status(401).json({
                success: false,
                message: 'Sesion invalida o expirada. Por favor, vuelve a iniciar sesion.'
            });
        }

        if (Date.now() > session.expiresAt) {
            sessionStore.delete(token);
            return res.status(401).json({
                success: false,
                message: 'Sesion expirada'
            });
        }

        // Agregar info de admin al request
        req.admin = {
            address: session.address,
            role: session.role,
            sessionToken: token
        };

        next();
    } catch (error) {
        console.error('Error verificando sesion admin:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Middleware: Verificar permiso específico
 */
function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                message: 'Sesion admin requerida'
            });
        }

        if (!hasPermission(req.admin.address, permission)) {
            return res.status(403).json({
                success: false,
                message: `Permiso requerido: ${permission}`
            });
        }

        next();
    };
}

/**
 * Middleware: Logout admin
 */
async function logoutAdmin(req, res) {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.slice(7)
            : req.headers['x-admin-token'];

        if (token) {
            const session = sessionStore.get(token);
            if (session) {
                await AuditLog.create({
                    action: 'admin_logout',
                    entity_type: 'admin',
                    actor_address: session.address,
                    ip_address: req.ip
                });
            }
            sessionStore.delete(token);
        }

        res.json({
            success: true,
            message: 'Sesion cerrada'
        });
    } catch (error) {
        console.error('Error en logout admin:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Limpiar sesiones y nonces expirados (ejecutar periódicamente)
 */
function cleanupExpired() {
    const now = Date.now();

    // Limpiar nonces
    for (const [key, value] of nonceStore.entries()) {
        if (now > value.expiresAt) {
            nonceStore.delete(key);
        }
    }

    // Limpiar sesiones
    for (const [key, value] of sessionStore.entries()) {
        if (now > value.expiresAt) {
            sessionStore.delete(key);
        }
    }
}

// Limpiar cada 5 minutos
setInterval(cleanupExpired, 5 * 60 * 1000);

module.exports = {
    generateSiweNonce,
    verifySiweSignature,
    requireAdminSession,
    requirePermission,
    logoutAdmin,
    SIWE_CONFIG,
    cleanupExpired
};
