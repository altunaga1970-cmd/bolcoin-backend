const express = require('express');
const router = express.Router();
const {
    generateSiweNonce,
    verifySiweSignature
} = require('../middleware/siweAuth');
const { requireAdmin } = require('../middleware/adminAuth');
const { isAdminWallet, getAdminRole, ADMIN_ROLES, ROLE_PERMISSIONS } = require('../config/adminWallets');

// =================================
// RUTAS DE AUTENTICACION ADMIN (SIWE)
// =================================

/**
 * GET /api/admin/auth/check
 * Verificar si una wallet es admin (sin autenticacion)
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
 * Verificar firma SIWE y emitir JWT
 */
router.post('/verify', verifySiweSignature);

/**
 * GET /api/admin/auth/session
 * Obtener informacion de la sesion actual (decodifica JWT)
 */
router.get('/session', requireAdmin, (req, res) => {
    res.json({
        success: true,
        data: {
            address: req.admin.address,
            role: req.admin.role,
            permissions: req.admin.permissions
        }
    });
});

/**
 * GET /api/admin/auth/me
 * Alias de /session
 */
router.get('/me', requireAdmin, (req, res) => {
    res.json({
        success: true,
        data: {
            address: req.admin.address,
            role: req.admin.role,
            permissions: req.admin.permissions
        }
    });
});

/**
 * POST /api/admin/auth/logout
 * Logout (JWT stateless — frontend limpia localStorage)
 */
router.post('/logout', (req, res) => {
    res.json({
        success: true,
        message: 'Sesion cerrada'
    });
});

/**
 * GET /api/admin/auth/roles
 * Obtener lista de roles disponibles
 */
router.get('/roles', requireAdmin, (req, res) => {
    res.json({
        success: true,
        data: {
            roles: ADMIN_ROLES,
            permissions: ROLE_PERMISSIONS
        }
    });
});

module.exports = router;
