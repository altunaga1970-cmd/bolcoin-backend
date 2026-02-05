-- =================================
-- MIGRATION: Admin Metrics & Referrals System
-- Version: 012
-- Description: Adds tables for financial metrics, referrals, and data cleanup
-- =================================

-- =================================
-- METRICAS DIARIAS AGREGADAS (permanentes)
-- =================================
CREATE TABLE IF NOT EXISTS daily_metrics (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_numbers_played INTEGER DEFAULT 0,
    total_amount_wagered DECIMAL(14, 2) DEFAULT 0,
    total_transactions INTEGER DEFAULT 0,
    total_prizes_paid DECIMAL(14, 2) DEFAULT 0,
    fees_collected DECIMAL(14, 2) DEFAULT 0,
    net_profit DECIMAL(14, 2) DEFAULT 0,
    referral_commissions_paid DECIMAL(14, 2) DEFAULT 0,
    unique_wallets INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date DESC);

COMMENT ON TABLE daily_metrics IS 'Metricas financieras agregadas por dia - datos permanentes';
COMMENT ON COLUMN daily_metrics.net_profit IS 'Ganancia neta = total_amount_wagered - total_prizes_paid - referral_commissions_paid';

-- =================================
-- METRICAS MENSUALES (permanentes)
-- =================================
CREATE TABLE IF NOT EXISTS monthly_metrics (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    total_numbers_played INTEGER DEFAULT 0,
    total_amount_wagered DECIMAL(14, 2) DEFAULT 0,
    total_transactions INTEGER DEFAULT 0,
    total_prizes_paid DECIMAL(14, 2) DEFAULT 0,
    fees_collected DECIMAL(14, 2) DEFAULT 0,
    net_profit DECIMAL(14, 2) DEFAULT 0,
    referral_commissions_paid DECIMAL(14, 2) DEFAULT 0,
    unique_wallets INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_metrics_year_month ON monthly_metrics(year DESC, month DESC);

COMMENT ON TABLE monthly_metrics IS 'Metricas financieras agregadas por mes - datos permanentes';

-- =================================
-- SISTEMA DE REFERIDOS
-- =================================
CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_wallet VARCHAR(42) NOT NULL,
    referral_code VARCHAR(10) UNIQUE NOT NULL,
    referred_wallet VARCHAR(42) UNIQUE,
    registration_method VARCHAR(20) CHECK (registration_method IN ('code', 'link')),
    total_bets_amount DECIMAL(14, 2) DEFAULT 0,
    total_commissions_generated DECIMAL(14, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'banned')),
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_wallet);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_wallet);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

COMMENT ON TABLE referrals IS 'Sistema de referidos - codigo unico + link con wallet';
COMMENT ON COLUMN referrals.referral_code IS 'Codigo unico generado (ej: ABC123)';
COMMENT ON COLUMN referrals.referred_wallet IS 'Wallet del referido (NULL hasta que se registre)';

-- =================================
-- COMISIONES DE REFERIDOS (3% del importe apostado)
-- =================================
CREATE TABLE IF NOT EXISTS referral_commissions (
    id SERIAL PRIMARY KEY,
    referral_id INTEGER REFERENCES referrals(id) ON DELETE SET NULL,
    referrer_wallet VARCHAR(42) NOT NULL,
    referred_wallet VARCHAR(42) NOT NULL,
    bet_id INTEGER REFERENCES bets(id) ON DELETE SET NULL,
    bet_amount DECIMAL(10, 2) NOT NULL,
    commission_rate DECIMAL(5, 4) DEFAULT 0.03,
    commission_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ref_comm_status ON referral_commissions(status);
CREATE INDEX IF NOT EXISTS idx_ref_comm_referrer ON referral_commissions(referrer_wallet);
CREATE INDEX IF NOT EXISTS idx_ref_comm_referred ON referral_commissions(referred_wallet);
CREATE INDEX IF NOT EXISTS idx_ref_comm_created ON referral_commissions(created_at DESC);

COMMENT ON TABLE referral_commissions IS 'Comisiones de referidos - 3% del importe apostado';
COMMENT ON COLUMN referral_commissions.commission_rate IS 'Tasa de comision (default 0.03 = 3%)';

-- =================================
-- LOG DE LIMPIEZA DE DATOS
-- =================================
CREATE TABLE IF NOT EXISTS data_cleanup_log (
    id SERIAL PRIMARY KEY,
    cleanup_type VARCHAR(50) NOT NULL,
    records_deleted INTEGER DEFAULT 0,
    tables_affected JSONB,
    metrics_aggregated JSONB,
    retention_days INTEGER DEFAULT 7,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_cleanup_log_started ON data_cleanup_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cleanup_log_status ON data_cleanup_log(status);

COMMENT ON TABLE data_cleanup_log IS 'Log de cada ejecucion de limpieza de datos';

-- =================================
-- TRIGGER PARA UPDATED_AT
-- =================================

-- Trigger para daily_metrics
DROP TRIGGER IF EXISTS update_daily_metrics_updated_at ON daily_metrics;
CREATE TRIGGER update_daily_metrics_updated_at
    BEFORE UPDATE ON daily_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para monthly_metrics
DROP TRIGGER IF EXISTS update_monthly_metrics_updated_at ON monthly_metrics;
CREATE TRIGGER update_monthly_metrics_updated_at
    BEFORE UPDATE ON monthly_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para referrals
DROP TRIGGER IF EXISTS update_referrals_updated_at ON referrals;
CREATE TRIGGER update_referrals_updated_at
    BEFORE UPDATE ON referrals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =================================
-- FUNCIONES UTILES PARA METRICAS
-- =================================

-- Funcion para calcular y guardar metricas del dia
CREATE OR REPLACE FUNCTION aggregate_daily_metrics(target_date DATE)
RETURNS void AS $$
DECLARE
    v_total_numbers INTEGER;
    v_total_amount DECIMAL(14, 2);
    v_total_transactions INTEGER;
    v_total_prizes DECIMAL(14, 2);
    v_fees DECIMAL(14, 2);
    v_commissions DECIMAL(14, 2);
    v_unique_wallets INTEGER;
BEGIN
    -- Contar numeros jugados (apuestas no-corrido-child)
    SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_total_numbers, v_total_amount
    FROM bets
    WHERE DATE(created_at) = target_date
    AND is_corrido_child = false;

    -- Contar transacciones
    SELECT COUNT(*)
    INTO v_total_transactions
    FROM transactions
    WHERE DATE(created_at) = target_date;

    -- Sumar premios pagados
    SELECT COALESCE(SUM(actual_payout), 0)
    INTO v_total_prizes
    FROM bets
    WHERE DATE(processed_at) = target_date
    AND status = 'won';

    -- Sumar fees (de operator_fees si existe)
    SELECT COALESCE(SUM(fee_amount), 0)
    INTO v_fees
    FROM operator_fees
    WHERE DATE(created_at) = target_date;

    -- Sumar comisiones de referidos pagadas
    SELECT COALESCE(SUM(commission_amount), 0)
    INTO v_commissions
    FROM referral_commissions
    WHERE DATE(paid_at) = target_date
    AND status = 'paid';

    -- Contar wallets unicas
    SELECT COUNT(DISTINCT u.wallet_address)
    INTO v_unique_wallets
    FROM bets b
    JOIN users u ON b.user_id = u.id
    WHERE DATE(b.created_at) = target_date;

    -- Insertar o actualizar metricas
    INSERT INTO daily_metrics (
        date, total_numbers_played, total_amount_wagered,
        total_transactions, total_prizes_paid, fees_collected,
        net_profit, referral_commissions_paid, unique_wallets
    ) VALUES (
        target_date, v_total_numbers, v_total_amount,
        v_total_transactions, v_total_prizes, v_fees,
        v_total_amount - v_total_prizes - v_commissions, v_commissions, v_unique_wallets
    )
    ON CONFLICT (date) DO UPDATE SET
        total_numbers_played = EXCLUDED.total_numbers_played,
        total_amount_wagered = EXCLUDED.total_amount_wagered,
        total_transactions = EXCLUDED.total_transactions,
        total_prizes_paid = EXCLUDED.total_prizes_paid,
        fees_collected = EXCLUDED.fees_collected,
        net_profit = EXCLUDED.net_profit,
        referral_commissions_paid = EXCLUDED.referral_commissions_paid,
        unique_wallets = EXCLUDED.unique_wallets,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Funcion para agregar metricas mensuales
CREATE OR REPLACE FUNCTION aggregate_monthly_metrics(target_year INTEGER, target_month INTEGER)
RETURNS void AS $$
BEGIN
    INSERT INTO monthly_metrics (
        year, month, total_numbers_played, total_amount_wagered,
        total_transactions, total_prizes_paid, fees_collected,
        net_profit, referral_commissions_paid, unique_wallets
    )
    SELECT
        target_year,
        target_month,
        COALESCE(SUM(total_numbers_played), 0),
        COALESCE(SUM(total_amount_wagered), 0),
        COALESCE(SUM(total_transactions), 0),
        COALESCE(SUM(total_prizes_paid), 0),
        COALESCE(SUM(fees_collected), 0),
        COALESCE(SUM(net_profit), 0),
        COALESCE(SUM(referral_commissions_paid), 0),
        COALESCE(SUM(unique_wallets), 0)
    FROM daily_metrics
    WHERE EXTRACT(YEAR FROM date) = target_year
    AND EXTRACT(MONTH FROM date) = target_month
    ON CONFLICT (year, month) DO UPDATE SET
        total_numbers_played = EXCLUDED.total_numbers_played,
        total_amount_wagered = EXCLUDED.total_amount_wagered,
        total_transactions = EXCLUDED.total_transactions,
        total_prizes_paid = EXCLUDED.total_prizes_paid,
        fees_collected = EXCLUDED.fees_collected,
        net_profit = EXCLUDED.net_profit,
        referral_commissions_paid = EXCLUDED.referral_commissions_paid,
        unique_wallets = EXCLUDED.unique_wallets,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- =================================
-- VISTAS UTILES
-- =================================

-- Vista de resumen financiero actual
CREATE OR REPLACE VIEW financial_summary AS
SELECT
    'today' as period,
    COALESCE(SUM(total_amount_wagered), 0) as total_wagered,
    COALESCE(SUM(total_prizes_paid), 0) as total_prizes,
    COALESCE(SUM(fees_collected), 0) as total_fees,
    COALESCE(SUM(net_profit), 0) as net_profit,
    COALESCE(SUM(total_transactions), 0) as transactions
FROM daily_metrics
WHERE date = CURRENT_DATE
UNION ALL
SELECT
    'this_month' as period,
    COALESCE(SUM(total_amount_wagered), 0),
    COALESCE(SUM(total_prizes_paid), 0),
    COALESCE(SUM(fees_collected), 0),
    COALESCE(SUM(net_profit), 0),
    COALESCE(SUM(total_transactions), 0)
FROM daily_metrics
WHERE EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
UNION ALL
SELECT
    'this_year' as period,
    COALESCE(SUM(total_amount_wagered), 0),
    COALESCE(SUM(total_prizes_paid), 0),
    COALESCE(SUM(fees_collected), 0),
    COALESCE(SUM(net_profit), 0),
    COALESCE(SUM(total_transactions), 0)
FROM daily_metrics
WHERE EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE);

-- Vista de estadisticas de referidos
CREATE OR REPLACE VIEW referral_stats AS
SELECT
    r.referrer_wallet,
    r.referral_code,
    r.status,
    COUNT(DISTINCT r2.id) as total_referrals,
    COALESCE(SUM(r.total_bets_amount), 0) as total_bets_from_referrals,
    COALESCE(SUM(r.total_commissions_generated), 0) as total_commissions
FROM referrals r
LEFT JOIN referrals r2 ON r2.referrer_wallet = r.referrer_wallet AND r2.referred_wallet IS NOT NULL
GROUP BY r.referrer_wallet, r.referral_code, r.status;

-- =================================
-- VERIFICACION
-- =================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('daily_metrics', 'monthly_metrics', 'referrals', 'referral_commissions', 'data_cleanup_log')
ORDER BY table_name;
