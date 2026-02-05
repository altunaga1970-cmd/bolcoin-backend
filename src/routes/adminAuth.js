const express = require('express');
const router = express.Router();
const {
    generateSiweNonce,
    verifySiweSignature,
    requireAdminSession,
    logoutAdmin
} = require('../middleware/siweAuth');
const { isAdminWallet, getAdminRole, ADMIN_ROLES, ROLE_PERMISSIONS } = require('../config/adminWallets');

// =================================
// RUTAS DE AUTENTICACIÓN ADMIN (SIWE)
// =================================

/**
 * GET /api/admin/auth/check
 * Verificar si una wallet es admin (sin autenticación)
 */
router.get('/check', (req, res) => {
    const { address } = req.query;

    if (!address) {
        return res.status(400).json({
            success: false,
            message: 'Direccion de wallet requerida'
        });
    }

    const isAdmin = isAdminWallet(address);
    const role = isAdmin ? getAdminRole(address) : null;

    res.json({
        success: true,
        data: {
            address: address.toLowerCase(),
            isAdmin,
            role
        }
    });
});

/**
 * GET /api/admin/auth/nonce
 * Obtener nonce para SIWE
 */
router.get('/nonce', generateSiweNonce);

/**
 * POST /api/admin/auth/verify
 * Verificar firma SIWE y crear sesión
 */
router.post('/verify', verifySiweSignature);

/**
 * GET /api/admin/auth/session
 * Obtener información de la sesión actual
 */
router.get('/session', requireAdminSession, (req, res) => {
    const permissions = ROLE_PERMISSIONS[req.admin.role] || [];

    res.json({
        success: true,
        data: {
            address: req.admin.address,
            role: req.admin.role,
            permissions
        }
    });
});

/**
 * GET /api/admin/auth/me
 * Alias de /session para compatibilidad
 */
router.get('/me', requireAdminSession, (req, res) => {
    const permissions = ROLE_PERMISSIONS[req.admin.role] || [];

    res.json({
        success: true,
        data: {
            address: req.admin.address,
            role: req.admin.role,
            permissions
        }
    });
});

/**
 * POST /api/admin/auth/logout
 * Cerrar sesión admin
 */
router.post('/logout', logoutAdmin);

/**
 * GET /api/admin/auth/roles
 * Obtener lista de roles disponibles
 */
router.get('/roles', requireAdminSession, (req, res) => {
    res.json({
        success: true,
        data: {
            roles: ADMIN_ROLES,
            permissions: ROLE_PERMISSIONS
        }
    });
});

module.exports = router;
