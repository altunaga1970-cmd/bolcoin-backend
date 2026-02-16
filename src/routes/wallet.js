const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticateWallet } = require('../middleware/web3Auth');
const { validateRecharge, validatePagination } = require('../middleware/validation');

// =================================
// RUTAS DE BILLETERA
// =================================

/**
 * GET /api/wallet/balance-by-address
 * Read-only balance lookup by wallet address (no signature required)
 * Only returns balance - no mutations possible
 */
router.get('/balance-by-address', async (req, res) => {
    try {
        const address = req.query.address;
        if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return res.status(400).json({ success: false, message: 'Valid wallet address required' });
        }

        const pool = require('../db');
        const result = await pool.query(
            'SELECT balance FROM users WHERE wallet_address = $1',
            [address.toLowerCase()]
        );

        const balance = result.rows[0]?.balance || '0';

        res.json({
            success: true,
            data: {
                balance: parseFloat(balance).toFixed(2),
                address: address.toLowerCase()
            }
        });
    } catch (err) {
        console.error('Error getting balance by address:', err);
        res.status(500).json({ success: false, message: 'Error' });
    }
});

// Authenticated routes below
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
