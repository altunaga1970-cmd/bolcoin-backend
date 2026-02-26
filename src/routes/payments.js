const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// Rutas protegidas (requieren autenticacion)
router.use(authenticate);

// Depositos (historial — los depositos reales son on-chain via USDT en Polygon)
router.get('/deposits', paymentController.getDeposits);

// Retiros
router.get('/withdrawal-limits', paymentController.getWithdrawalLimits);
router.post('/withdraw', paymentController.requestWithdrawal);
router.get('/withdrawals', paymentController.getWithdrawals);

module.exports = router;
