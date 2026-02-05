const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  console.log('Ejecutando migracion: add-payments-tables...\n');

  try {
    await pool.query('BEGIN');

    // Tabla de pagos/depositos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        payment_id VARCHAR(100) UNIQUE,
        payment_status VARCHAR(30) DEFAULT 'waiting',
        pay_address VARCHAR(200),
        pay_currency VARCHAR(10),
        pay_amount DECIMAL(20,8),
        price_amount DECIMAL(12,2) NOT NULL,
        actually_paid DECIMAL(20,8) DEFAULT 0,
        outcome_amount DECIMAL(12,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      )
    `);
    console.log('Tabla payments creada');

    // Indices para payments
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(payment_id)
    `);
    console.log('Indices de payments creados');

    // Tabla de retiros
    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount DECIMAL(12,2) NOT NULL,
        crypto_currency VARCHAR(10) NOT NULL,
        wallet_address VARCHAR(200) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        payout_id VARCHAR(100),
        requires_approval BOOLEAN DEFAULT FALSE,
        approved_by INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        CONSTRAINT chk_withdrawal_amount CHECK (amount >= 5)
      )
    `);
    console.log('Tabla withdrawals creada');

    // Indices para withdrawals
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawals_requires_approval ON withdrawals(requires_approval) WHERE requires_approval = true
    `);
    console.log('Indices de withdrawals creados');

    await pool.query('COMMIT');
    console.log('\nMigracion completada exitosamente!');

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error en migracion:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

migrate().catch(console.error);
