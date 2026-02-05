const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticateWallet } = require('../middleware/web3Auth');
const { validateRecharge, validatePagination } = require('../middleware/validation');

// =================================
// RUTAS DE BILLETERA
// =================================

// Todas las rutas requieren autenticación Web3
router.use(authenticateWallet);

/**
 * POST /api/wallet/recharge
 * Recargar balance del usuario
 */
router.post('/recharge', validateRecharge, walletController.recharge);

/**
 * GET /api/wallet/balance
 * Obtener balance actual del usuario
 */
router.get('/balance', walletController.getBalance);

/**
 * GET /api/wallet/transactions
 * Obtener historial de transacciones
 * Query params: page, limit, type
 */
router.get('/transactions', validatePagination, walletController.getTransactions);

module.exports = router;
