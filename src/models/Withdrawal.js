const pool = require('../db');

const Withdrawal = {
  /**
   * Crear una nueva solicitud de retiro
   */
  async create(userId, withdrawalData) {
    const {
      amount,
      crypto_currency,
      wallet_address,
      requires_approval = false
    } = withdrawalData;

    const result = await pool.query(
      `INSERT INTO withdrawals
       (user_id, amount, crypto_currency, wallet_address, requires_approval, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, amount, crypto_currency, wallet_address, requires_approval, 'pending']
    );

    return result.rows[0];
  },

  /**
   * Buscar retiro por ID
   */
  async findById(id) {
    const result = await pool.query(
      `SELECT w.*, u.username, u.email
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.id = $1`,
      [id]
    );
    return result.rows[0];
  },

  /**
   * Buscar retiros de un usuario
   */
  async findByUserId(userId, options = {}) {
    const { page = 1, limit = 10, status = null } = options;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM withdrawals WHERE user_id = $1';
    const params = [userId];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Contar total
    let countQuery = 'SELECT COUNT(*) FROM withdrawals WHERE user_id = $1';
    const countParams = [userId];
    if (status) {
      countQuery += ' AND status = $2';
      countParams.push(status);
    }
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    return {
      withdrawals: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  /**
   * Obtener retiros pendientes de aprobacion
   */
  async findPendingApproval(options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT w.*, u.username, u.email
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.status = 'pending' AND w.requires_approval = true
       ORDER BY w.created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM withdrawals
       WHERE status = 'pending' AND requires_approval = true`
    );
    const total = parseInt(countResult.rows[0].count);

    return {
      withdrawals: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  /**
   * Obtener todos los retiros (admin)
   */
  async findAll(options = {}) {
    const { page = 1, limit = 20, status = null } = options;
    const offset = (page - 1) * limit;

    let query = `
      SELECT w.*, u.username, u.email
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE w.status = $1';
      params.push(status);
    }

    query += ' ORDER BY w.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Contar total
    let countQuery = 'SELECT COUNT(*) FROM withdrawals';
    const countParams = [];
    if (status) {
      countQuery += ' WHERE status = $1';
      countParams.push(status);
    }
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    return {
      withdrawals: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  /**
   * Actualizar estado del retiro
   */
  async updateStatus(id, status, additionalData = {}) {
    const { payout_id, approved_by, rejection_reason } = additionalData;

    let query = 'UPDATE withdrawals SET status = $1';
    const params = [status];

    if (payout_id) {
      params.push(payout_id);
      query += `, payout_id = $${params.length}`;
    }

    if (approved_by) {
      params.push(approved_by);
      query += `, approved_by = $${params.length}, approved_at = CURRENT_TIMESTAMP`;
    }

    if (rejection_reason) {
      params.push(rejection_reason);
      query += `, rejection_reason = $${params.length}`;
    }

    if (status === 'completed') {
      query += ', completed_at = CURRENT_TIMESTAMP';
    }

    params.push(id);
    query += ` WHERE id = $${params.length} RETURNING *`;

    const result = await pool.query(query, params);
    return result.rows[0];
  },

  /**
   * Aprobar retiro
   */
  async approve(id, adminId) {
    return this.updateStatus(id, 'approved', { approved_by: adminId });
  },

  /**
   * Rechazar retiro
   */
  async reject(id, adminId, reason) {
    const result = await pool.query(
      `UPDATE withdrawals
       SET status = 'rejected',
           approved_by = $1,
           approved_at = CURRENT_TIMESTAMP,
           rejection_reason = $2
       WHERE id = $3
       RETURNING *`,
      [adminId, reason, id]
    );
    return result.rows[0];
  },

  /**
   * Marcar retiro como procesando
   */
  async markProcessing(id, payoutId) {
    return this.updateStatus(id, 'processing', { payout_id: payoutId });
  },

  /**
   * Marcar retiro como completado
   */
  async markCompleted(id) {
    return this.updateStatus(id, 'completed');
  }
};

module.exports = Withdrawal;
