const { ethers } = require('ethers');
const crypto = require('crypto');
const { isAdminWallet, getAdminRole, hasPermission, ADMIN_ROLES, ROLE_PERMISSIONS } = require('../config/adminWallets');
const { generateToken } = require('../config/auth');
const { ERROR_MESSAGES, AUDIT_ACTIONS } = require('../config/constants');
const AuditLog = require('../models/AuditLog');

// =================================
// SIWE (Sign-In With Ethereum) AUTH
// =================================

/**
 * Store para nonces (corta vida, OK en memoria)
 */
const nonceStore = new Map();

/**
 * Configuracion SIWE
 */
const SIWE_CONFIG = {
    NONCE_EXPIRY_MS: 5 * 60 * 1000,       // 5 minutos para usar el nonce
    DOMAIN: process.env.SIWE_DOMAIN || 'localhost',
    STATEMENT: 'Iniciar sesion como administrador en La Bolita'
};

/**
 * Generar nonce unico
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

        // Guardar nonce con expiracion
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
 * Middleware: Verificar firma SIWE y emitir JWT
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

        // Verificar que el nonce esta en el mensaje
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

        // Generar JWT stateless en vez de session token
        const role = getAdminRole(normalizedAddress);
        const permissions = ROLE_PERMISSIONS[role] || [];

        const token = generateToken({
            address: normalizedAddress,
            role,
            permissions,
            type: 'admin'
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
                token,
                address: normalizedAddress,
                role,
                permissions,
                expiresIn: 4 * 60 * 60 // 4h en segundos
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
 * Limpiar nonces expirados (ejecutar periodicamente)
 */
function cleanupExpired() {
    const now = Date.now();

    for (const [key, value] of nonceStore.entries()) {
        if (now > value.expiresAt) {
            nonceStore.delete(key);
        }
    }
}

// Limpiar cada 5 minutos
setInterval(cleanupExpired, 5 * 60 * 1000);

module.exports = {
    generateSiweNonce,
    verifySiweSignature,
    SIWE_CONFIG,
    cleanupExpired
};
