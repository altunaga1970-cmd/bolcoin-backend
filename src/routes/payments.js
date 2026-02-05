const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const webhookController = require('../controllers/webhookController');
const { authenticate } = require('../middleware/auth');

// Rutas publicas (webhooks)
router.post('/webhooks/nowpayments', webhookController.handleNowPaymentsIPN);

// Ruta de prueba para simular webhook (solo desarrollo)
if (process.env.NODE_ENV !== 'production') {
  router.post('/webhooks/simulate', webhookController.simulateWebhook);
}

// Rutas protegidas (requieren autenticacion)
router.use(authenticate);

// Depositos
router.get('/currencies', paymentController.getCurrencies);
router.get('/min-amount/:currency', paymentController.getMinAmount);
router.post('/deposit', paymentController.createDeposit);
router.get('/deposit/:id', paymentController.getDepositStatus);
router.get('/deposits', paymentController.getDeposits);

// Retiros
router.get('/withdrawal-limits', paymentController.getWithdrawalLimits);
router.post('/withdraw', paymentController.requestWithdrawal);
router.get('/withdrawals', paymentController.getWithdrawals);

module.exports = router;
