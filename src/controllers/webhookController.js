const nowPaymentsService = require('../services/nowPaymentsService');
const Payment = require('../models/Payment');
const Withdrawal = require('../models/Withdrawal');
const { creditDeposit } = require('./paymentController');

/**
 * Manejar webhook IPN de NOWPayments
 */
async function handleNowPaymentsIPN(req, res) {
  try {
    const payload = req.body;
    const signature = req.headers['x-nowpayments-sig'];

    console.log('Webhook IPN recibido:', JSON.stringify(payload));

    // Verificar firma (en produccion)
    if (process.env.NODE_ENV === 'production') {
      const isValid = nowPaymentsService.verifyIPNSignature(payload, signature);
      if (!isValid) {
        console.error('Firma IPN invalida');
        return res.status(400).json({ error: 'Invalid signature' });
      }
    }

    const { payment_id, payment_status, actually_paid, outcome_amount } = payload;

    // Buscar el pago en nuestra DB
    const payment = await Payment.findByPaymentId(payment_id);

    if (!payment) {
      console.log(`Pago no encontrado: ${payment_id}`);
      // Responder OK para que NOWPayments no reintente
      return res.status(200).json({ received: true });
    }

    // Si ya estaba completado, ignorar
    if (payment.payment_status === 'finished') {
      return res.status(200).json({ received: true, already_processed: true });
    }

    // Actualizar estado
    await Payment.updateStatus(payment_id, payment_status, {
      actually_paid,
      outcome_amount
    });

    console.log(`Pago ${payment_id} actualizado a: ${payment_status}`);

    // Si el pago se completo, acreditar balance
    if (payment_status === 'finished') {
      const amountToCredit = outcome_amount || payment.price_amount;
      await creditDeposit(payment.user_id, amountToCredit, payment.id);
      console.log(`Balance acreditado: ${amountToCredit} USDT al usuario ${payment.user_id}`);
    }

    // Estados de error
    if (payment_status === 'failed' || payment_status === 'expired') {
      console.log(`Pago ${payment_id} fallido/expirado: ${payment_status}`);
    }

    res.status(200).json({
      received: true,
      payment_id,
      status: payment_status
    });

  } catch (error) {
    console.error('Error procesando webhook IPN:', error.message);
    // Responder OK para evitar reintentos excesivos
    res.status(200).json({ received: true, error: error.message });
  }
}

/**
 * Manejar webhook de payout (retiro) de NOWPayments
 */
async function handlePayoutWebhook(req, res) {
  try {
    const payload = req.body;
    const signature = req.headers['x-nowpayments-sig'];

    console.log('Webhook Payout recibido:', JSON.stringify(payload));

    // Verificar firma (en produccion)
    if (process.env.NODE_ENV === 'production') {
      const isValid = nowPaymentsService.verifyIPNSignature(payload, signature);
      if (!isValid) {
        console.error('Firma Payout webhook invalida');
        return res.status(400).json({ error: 'Invalid signature' });
      }
    }

    const { id: payoutId, status } = payload;

    // Buscar retiro por payout_id
    // Nota: Esto requeriría una función adicional en el modelo Withdrawal
    // Por ahora solo logueamos

    console.log(`Payout ${payoutId} status: ${status}`);

    if (status === 'FINISHED') {
      // Marcar retiro como completado
      // await Withdrawal.markCompletedByPayoutId(payoutId);
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Error procesando payout webhook:', error.message);
    res.status(200).json({ received: true, error: error.message });
  }
}

/**
 * Endpoint de prueba para simular webhook (solo desarrollo)
 */
async function simulateWebhook(req, res) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const { payment_id, status } = req.body;

    if (!payment_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'payment_id y status son requeridos'
      });
    }

    const payment = await Payment.findByPaymentId(payment_id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Pago no encontrado'
      });
    }

    // Simular actualizacion
    await Payment.updateStatus(payment_id, status, {
      actually_paid: payment.pay_amount,
      outcome_amount: payment.price_amount
    });

    // Si es "finished", acreditar
    if (status === 'finished') {
      await creditDeposit(payment.user_id, payment.price_amount, payment.id);
    }

    res.json({
      success: true,
      message: `Pago ${payment_id} actualizado a ${status}`,
      credited: status === 'finished'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

module.exports = {
  handleNowPaymentsIPN,
  handlePayoutWebhook,
  simulateWebhook
};
