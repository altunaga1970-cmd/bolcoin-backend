const pool = require('../db');

const Payment = {
  /**
   * Crear un nuevo pago
   */
  async create(userId, paymentData) {
    const {
      payment_id,
      payment_status,
      pay_address,
      pay_currency,
      pay_amount,
      price_amount,
      expires_at
    } = paymentData;

    const result = await pool.query(
      `INSERT INTO payments
       (user_id, payment_id, payment_status, pay_address, pay_currency, pay_amount, price_amount, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, payment_id, payment_status || 'waiting', pay_address, pay_currency, pay_amount, price_amount, expires_at]
    );

    return result.rows[0];
  },

  /**
   * Buscar pago por ID interno
   */
  async findById(id) {
    const result = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [id]
    );
    return result.rows[0];
  },

  /**
   * Buscar pago por payment_id de NOWPayments
   */
  async findByPaymentId(paymentId) {
    const result = await pool.query(
      'SELECT * FROM payments WHERE payment_id = $1',
      [paymentId]
    );
    return result.rows[0];
  },

  /**
   * Buscar pagos de un usuario
   */
  async findByUserId(userId, options = {}) {
    const { page = 1, limit = 10, status = null } = options;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM payments WHERE user_id = $1';
    const params = [userId];

    if (status) {
      query += ' AND payment_status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Contar total
    let countQuery = 'SELECT COUNT(*) FROM payments WHERE user_id = $1';
    const countParams = [userId];
    if (status) {
      countQuery += ' AND payment_status = $2';
      countParams.push(status);
    }
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    return {
      payments: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  /**
   * Actualizar estado del pago
   */
  async updateStatus(paymentId, status, additionalData = {}) {
    const { actually_paid, outcome_amount } = additionalData;

    let query = 'UPDATE payments SET payment_status = $1, updated_at = CURRENT_TIMESTAMP';
    const params = [status];

    if (actually_paid !== undefined) {
      params.push(actually_paid);
      query += `, actually_paid = $${params.length}`;
    }

    if (outcome_amount !== undefined) {
      params.push(outcome_amount);
      query += `, outcome_amount = $${params.length}`;
    }

    params.push(paymentId);
    query += ` WHERE payment_id = $${params.length} RETURNING *`;

    const result = await pool.query(query, params);
    return result.rows[0];
  },

  /**
   * Obtener pagos pendientes expirados
   */
  async findExpired() {
    const result = await pool.query(
      `SELECT * FROM payments
       WHERE payment_status = 'waiting'
       AND expires_at < CURRENT_TIMESTAMP`
    );
    return result.rows;
  },

  /**
   * Marcar pagos expirados
   */
  async markExpired() {
    const result = await pool.query(
      `UPDATE payments
       SET payment_status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE payment_status = 'waiting'
       AND expires_at < CURRENT_TIMESTAMP
       RETURNING *`
    );
    return result.rows;
  }
};

module.exports = Payment;
