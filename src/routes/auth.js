const express = require('express');
const router = express.Router();
const { authenticateWallet, requireSignature, optionalWalletAuth } = require('../middleware/web3Auth');

// =================================
// RUTAS DE AUTENTICACIÓN WEB3
// =================================

/**
 * GET /api/auth/nonce
 * Genera un nonce para firmar (preparacion para SIWE)
 */
router.get('/nonce', (req, res) => {
    const nonce = `Bienvenido a La Bolita!\n\nFirma este mensaje para verificar tu wallet.\n\nNonce: ${Date.now()}-${Math.random().toString(36).substring(7)}`;

    res.json({
        success: true,
        nonce
    });
});

/**
 * POST /api/auth/verify
 * Verifica la firma de una wallet
 */
router.post('/verify', requireSignature, (req, res) => {
    res.json({
        success: true,
        user: {
            address: req.user.address,
            role: req.user.role
        },
        message: 'Wallet verificada correctamente'
    });
});

/**
 * GET /api/auth/me
 * Obtener información del usuario por wallet
 */
router.get('/me', authenticateWallet, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            address: req.user.address,
            role: req.user.role
        }
    });
});

/**
 * GET /api/auth/status
 * Verificar estado de autenticación
 */
router.get('/status', optionalWalletAuth, (req, res) => {
    res.json({
        success: true,
        authenticated: !!req.user,
        user: req.user || null
    });
});

// =================================
// RUTAS DEPRECADAS (Web3-only)
// =================================

/**
 * @deprecated - Web3-only mode
 * POST /api/auth/register
 */
router.post('/register', (req, res) => {
    res.status(410).json({
        success: false,
        message: 'Registro tradicional deshabilitado. Por favor conecta tu wallet.',
        web3Only: true
    });
});

/**
 * @deprecated - Web3-only mode
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
    res.status(410).json({
        success: false,
        message: 'Login tradicional deshabilitado. Por favor conecta tu wallet.',
        web3Only: true
    });
});

/**
 * POST /api/auth/logout
 * En Web3, el logout es del lado del cliente (desconectar wallet)
 */
router.post('/logout', (req, res) => {
    res.json({
        success: true,
        message: 'Para cerrar sesion, desconecta tu wallet.'
    });
});

module.exports = router;
