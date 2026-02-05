const axios = require('axios');
const crypto = require('crypto');

const API_KEY = process.env.NOWPAYMENTS_API_KEY;
const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const SANDBOX = process.env.NOWPAYMENTS_SANDBOX === 'true';

const BASE_URL = SANDBOX
  ? 'https://api-sandbox.nowpayments.io/v1'
  : 'https://api.nowpayments.io/v1';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
  }
});

/**
 * Verificar estado de la API
 */
async function getStatus() {
  const response = await api.get('/status');
  return response.data;
}

/**
 * Obtener lista de criptomonedas disponibles
 */
async function getAvailableCurrencies() {
  const response = await api.get('/currencies');
  return response.data.currencies || [];
}

/**
 * Obtener monto minimo de pago para una criptomoneda
 */
async function getMinPaymentAmount(currencyFrom, currencyTo = 'usdttrc20') {
  const response = await api.get('/min-amount', {
    params: {
      currency_from: currencyFrom,
      currency_to: currencyTo
    }
  });
  return response.data.min_amount;
}

/**
 * Obtener estimacion de precio (cuanto crypto por X USDT)
 */
async function getEstimatedPrice(amount, currencyFrom, currencyTo = 'usdttrc20') {
  const response = await api.get('/estimate', {
    params: {
      amount: amount,
      currency_from: currencyFrom,
      currency_to: currencyTo
    }
  });
  return response.data;
}

/**
 * Crear un pago/deposito
 * @param {number} priceAmount - Monto en USDT
 * @param {string} payCurrency - Criptomoneda a recibir (btc, eth, ltc, etc)
 * @param {string} orderId - ID interno de la orden
 * @param {string} orderDescription - Descripcion
 */
async function createPayment(priceAmount, payCurrency, orderId, orderDescription = '') {
  const payload = {
    price_amount: priceAmount,
    price_currency: 'usd', // Precio en USD (equivalente a USDT)
    pay_currency: payCurrency,
    order_id: orderId,
    order_description: orderDescription || `Deposito La Bolita #${orderId}`,
    ipn_callback_url: process.env.NOWPAYMENTS_IPN_URL || `${process.env.BACKEND_URL}/api/webhooks/nowpayments`
  };

  const response = await api.post('/payment', payload);
  return response.data;
}

/**
 * Obtener estado de un pago
 */
async function getPaymentStatus(paymentId) {
  const response = await api.get(`/payment/${paymentId}`);
  return response.data;
}

/**
 * Crear un payout (retiro)
 * @param {string} address - Direccion de la wallet destino
 * @param {number} amount - Monto en la criptomoneda
 * @param {string} currency - Criptomoneda (btc, eth, etc)
 */
async function createPayout(address, amount, currency) {
  const payload = {
    address: address,
    amount: amount,
    currency: currency,
    ipn_callback_url: process.env.NOWPAYMENTS_IPN_URL || `${process.env.BACKEND_URL}/api/webhooks/nowpayments`
  };

  const response = await api.post('/payout', payload);
  return response.data;
}

/**
 * Obtener estado de un payout
 */
async function getPayoutStatus(payoutId) {
  const response = await api.get(`/payout/${payoutId}`);
  return response.data;
}

/**
 * Verificar firma IPN de webhook
 */
function verifyIPNSignature(payload, receivedSignature) {
  if (!IPN_SECRET) {
    console.warn('NOWPAYMENTS_IPN_SECRET no configurado');
    return false;
  }

  // Ordenar payload alfabeticamente y crear string
  const sortedPayload = sortObject(payload);
  const payloadString = JSON.stringify(sortedPayload);

  // Crear HMAC SHA-512
  const hmac = crypto.createHmac('sha512', IPN_SECRET);
  hmac.update(payloadString);
  const calculatedSignature = hmac.digest('hex');

  return calculatedSignature === receivedSignature;
}

/**
 * Ordenar objeto alfabeticamente (requerido para verificar firma)
 */
function sortObject(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        result[key] = sortObject(obj[key]);
      } else {
        result[key] = obj[key];
      }
      return result;
    }, {});
}

/**
 * Convertir monto de crypto a USDT
 */
async function convertToUSDT(amount, fromCurrency) {
  try {
    const estimate = await getEstimatedPrice(amount, fromCurrency, 'usdttrc20');
    return estimate.estimated_amount || 0;
  } catch (error) {
    console.error('Error convirtiendo a USDT:', error.message);
    return 0;
  }
}

/**
 * Obtener tasa de cambio actual
 */
async function getExchangeRate(fromCurrency, toCurrency = 'usd') {
  try {
    const estimate = await getEstimatedPrice(1, fromCurrency, toCurrency);
    return estimate.estimated_amount || 0;
  } catch (error) {
    console.error('Error obteniendo tasa de cambio:', error.message);
    return 0;
  }
}

module.exports = {
  getStatus,
  getAvailableCurrencies,
  getMinPaymentAmount,
  getEstimatedPrice,
  createPayment,
  getPaymentStatus,
  createPayout,
  getPayoutStatus,
  verifyIPNSignature,
  convertToUSDT,
  getExchangeRate
};
