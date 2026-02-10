const pool = require('../../db');

async function up() {
  console.log('Ejecutando migracion: add-payments-tables...\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
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

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status);
      CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(payment_id);
    `);

    await client.query(`
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

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_requires_approval ON withdrawals(requires_approval) WHERE requires_approval = true;
    `);

    await client.query('COMMIT');
    console.log('[Migration] Payments and withdrawals tables created successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error creating payments tables:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP TABLE IF EXISTS withdrawals CASCADE');
    await client.query('DROP TABLE IF EXISTS payments CASCADE');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const action = process.argv[2];
  if (action === 'up') {
    up().then(() => process.exit(0)).catch(() => process.exit(1));
  } else if (action === 'down') {
    down().then(() => process.exit(0)).catch(() => process.exit(1));
  } else {
    console.log('Usage: node add-payments-tables.js [up|down]');
    process.exit(1);
  }
}

module.exports = { up, down };
