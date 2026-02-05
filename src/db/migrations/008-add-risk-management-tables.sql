-- Migration 008: Add Risk Management Tables
-- Sistema de gestion de riesgo para La Bolita

-- ============================================
-- Tabla: daily_exposure
-- Tracking de exposicion diaria por numero/tipo
-- ============================================
CREATE TABLE IF NOT EXISTS daily_exposure (
    id SERIAL PRIMARY KEY,
    day_id INTEGER NOT NULL,                    -- Unix timestamp / 86400
    bet_type VARCHAR(10) NOT NULL,              -- 'fijo', 'centena', 'parle'
    number VARCHAR(4) NOT NULL,                 -- El numero apostado
    total_stake DECIMAL(20, 6) DEFAULT 0,       -- Total apostado a este numero
    total_liability DECIMAL(20, 6) DEFAULT 0,   -- Pago potencial maximo
    bet_count INTEGER DEFAULT 0,                -- Cantidad de apuestas
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(day_id, bet_type, number)
);

CREATE INDEX IF NOT EXISTS idx_daily_exposure_day ON daily_exposure(day_id);
CREATE INDEX IF NOT EXISTS idx_daily_exposure_lookup ON daily_exposure(day_id, bet_type, number);

-- ============================================
-- Tabla: daily_settlements
-- Liquidacion de resultados diarios
-- ============================================
CREATE TABLE IF NOT EXISTS daily_settlements (
    id SERIAL PRIMARY KEY,
    day_id INTEGER NOT NULL UNIQUE,             -- Unix timestamp / 86400
    total_staked DECIMAL(20, 6) DEFAULT 0,      -- Total apostado en el dia
    total_paid_out DECIMAL(20, 6) DEFAULT 0,    -- Total pagado a ganadores
    profit_or_loss DECIMAL(20, 6) DEFAULT 0,    -- Ganancia/perdida del dia
    draws_count INTEGER DEFAULT 0,              -- Cantidad de sorteos liquidados
    bets_count INTEGER DEFAULT 0,               -- Cantidad de apuestas
    winners_count INTEGER DEFAULT 0,            -- Cantidad de ganadores
    settled BOOLEAN DEFAULT FALSE,
    settled_at TIMESTAMP,
    settled_by VARCHAR(42),                     -- Wallet address del admin
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_settlements_day ON daily_settlements(day_id);
CREATE INDEX IF NOT EXISTS idx_daily_settlements_settled ON daily_settlements(settled);

-- ============================================
-- Tabla: monthly_accounting
-- Contabilidad mensual y comisiones
-- ============================================
CREATE TABLE IF NOT EXISTS monthly_accounting (
    id SERIAL PRIMARY KEY,
    month_id INTEGER NOT NULL UNIQUE,           -- YYYYMM format (ej: 202601)
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    total_staked DECIMAL(20, 6) DEFAULT 0,      -- Total apostado en el mes
    total_paid_out DECIMAL(20, 6) DEFAULT 0,    -- Total pagado en el mes
    net_profit DECIMAL(20, 6) DEFAULT 0,        -- Beneficio neto del mes
    operator_fee DECIMAL(20, 6) DEFAULT 0,      -- Comision calculada (15% del beneficio)
    commission_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP,
    paid_tx_hash VARCHAR(66),                   -- Transaction hash del pago
    days_settled INTEGER DEFAULT 0,             -- Dias liquidados en el mes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_monthly_accounting_month ON monthly_accounting(month_id);
CREATE INDEX IF NOT EXISTS idx_monthly_accounting_year ON monthly_accounting(year, month);

-- ============================================
-- Tabla: bankroll_snapshots
-- Historial de estado del bankroll
-- ============================================
CREATE TABLE IF NOT EXISTS bankroll_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_pool DECIMAL(20, 6) NOT NULL,         -- Pool total
    usable_balance DECIMAL(20, 6) NOT NULL,     -- Balance utilizable (sin reservas)
    reserve_amount DECIMAL(20, 6) NOT NULL,     -- Monto en reserva
    payout_cap DECIMAL(20, 6) NOT NULL,         -- Cap de pago actual
    reserve_ratio_bps INTEGER NOT NULL,         -- Ratio de reserva en basis points
    risk_factor_bps INTEGER NOT NULL,           -- Factor de riesgo en basis points
    absolute_max_payout DECIMAL(20, 6) NOT NULL,
    pending_operator_fees DECIMAL(20, 6) DEFAULT 0,
    source VARCHAR(50),                         -- 'manual', 'auto', 'deposit', 'withdrawal'
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_bankroll_snapshots_time ON bankroll_snapshots(snapshot_time DESC);

-- ============================================
-- Tabla: risk_config
-- Configuracion de parametros de riesgo
-- ============================================
CREATE TABLE IF NOT EXISTS risk_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(50) NOT NULL UNIQUE,
    config_value VARCHAR(255) NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(42)
);

-- Insertar configuracion inicial
INSERT INTO risk_config (config_key, config_value, description) VALUES
    ('reserve_ratio_bps', '3000', '30% del pool en reserva'),
    ('risk_factor_bps', '1000', '10% del usable para riesgo diario'),
    ('absolute_max_payout', '10000000000', '10,000 USDT max payout (6 decimales)'),
    ('operator_commission_bps', '1500', '15% comision sobre beneficio positivo'),
    ('min_bet_amount', '1000000', '1 USDT minimo (6 decimales)'),
    ('max_bet_amount', '10000000', '10 USDT maximo (6 decimales)'),
    ('fijo_multiplier', '650000', '65x multiplicador fijo'),
    ('centena_multiplier', '3000000', '300x multiplicador centena'),
    ('parle_multiplier', '10000000', '1000x multiplicador parle')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================
-- Tabla: exposure_alerts
-- Alertas cuando la exposicion se acerca al limite
-- ============================================
CREATE TABLE IF NOT EXISTS exposure_alerts (
    id SERIAL PRIMARY KEY,
    day_id INTEGER NOT NULL,
    bet_type VARCHAR(10) NOT NULL,
    number VARCHAR(4) NOT NULL,
    current_liability DECIMAL(20, 6) NOT NULL,
    payout_cap DECIMAL(20, 6) NOT NULL,
    percentage_used DECIMAL(5, 2) NOT NULL,     -- Porcentaje del cap usado
    alert_level VARCHAR(20) NOT NULL,           -- 'warning' (>70%), 'critical' (>90%), 'blocked' (100%)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(42),
    acknowledged_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exposure_alerts_day ON exposure_alerts(day_id);
CREATE INDEX IF NOT EXISTS idx_exposure_alerts_level ON exposure_alerts(alert_level);
CREATE INDEX IF NOT EXISTS idx_exposure_alerts_unacked ON exposure_alerts(acknowledged) WHERE acknowledged = FALSE;

-- ============================================
-- Tabla: operator_withdrawals
-- Historial de retiros del operador
-- ============================================
CREATE TABLE IF NOT EXISTS operator_withdrawals (
    id SERIAL PRIMARY KEY,
    amount DECIMAL(20, 6) NOT NULL,
    withdrawal_type VARCHAR(20) NOT NULL,       -- 'commission', 'surplus', 'emergency'
    month_id INTEGER,                           -- Para comisiones mensuales
    tx_hash VARCHAR(66),
    withdrawn_by VARCHAR(42) NOT NULL,
    withdrawn_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_operator_withdrawals_type ON operator_withdrawals(withdrawal_type);
CREATE INDEX IF NOT EXISTS idx_operator_withdrawals_month ON operator_withdrawals(month_id);

-- ============================================
-- Vista: v_current_day_exposure
-- Resumen de exposicion del dia actual
-- ============================================
CREATE OR REPLACE VIEW v_current_day_exposure AS
SELECT
    de.bet_type,
    de.number,
    de.total_stake,
    de.total_liability,
    de.bet_count,
    rc.config_value::DECIMAL AS payout_cap,
    CASE
        WHEN rc.config_value::DECIMAL > 0
        THEN ROUND((de.total_liability / rc.config_value::DECIMAL) * 100, 2)
        ELSE 0
    END AS liability_percentage
FROM daily_exposure de
CROSS JOIN (SELECT config_value FROM risk_config WHERE config_key = 'absolute_max_payout') rc
WHERE de.day_id = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::INTEGER / 86400
ORDER BY de.total_liability DESC;

-- ============================================
-- Vista: v_monthly_summary
-- Resumen mensual para dashboard
-- ============================================
CREATE OR REPLACE VIEW v_monthly_summary AS
SELECT
    ma.month_id,
    ma.year,
    ma.month,
    ma.total_staked,
    ma.total_paid_out,
    ma.net_profit,
    ma.operator_fee,
    ma.commission_paid,
    ma.days_settled,
    CASE
        WHEN ma.total_staked > 0
        THEN ROUND((ma.net_profit / ma.total_staked) * 100, 2)
        ELSE 0
    END AS profit_margin_percentage
FROM monthly_accounting ma
ORDER BY ma.month_id DESC;

-- ============================================
-- Funcion: update_exposure
-- Actualizar exposicion cuando se hace una apuesta
-- ============================================
CREATE OR REPLACE FUNCTION update_exposure(
    p_day_id INTEGER,
    p_bet_type VARCHAR(10),
    p_number VARCHAR(4),
    p_stake DECIMAL(20, 6),
    p_liability DECIMAL(20, 6)
) RETURNS TABLE(
    new_total_stake DECIMAL(20, 6),
    new_total_liability DECIMAL(20, 6),
    new_bet_count INTEGER
) AS $$
BEGIN
    INSERT INTO daily_exposure (day_id, bet_type, number, total_stake, total_liability, bet_count)
    VALUES (p_day_id, p_bet_type, p_number, p_stake, p_liability, 1)
    ON CONFLICT (day_id, bet_type, number)
    DO UPDATE SET
        total_stake = daily_exposure.total_stake + p_stake,
        total_liability = daily_exposure.total_liability + p_liability,
        bet_count = daily_exposure.bet_count + 1,
        updated_at = CURRENT_TIMESTAMP;

    RETURN QUERY
    SELECT de.total_stake, de.total_liability, de.bet_count
    FROM daily_exposure de
    WHERE de.day_id = p_day_id
      AND de.bet_type = p_bet_type
      AND de.number = p_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Funcion: check_exposure_limit
-- Verificar si una apuesta excede el limite
-- ============================================
CREATE OR REPLACE FUNCTION check_exposure_limit(
    p_day_id INTEGER,
    p_bet_type VARCHAR(10),
    p_number VARCHAR(4),
    p_new_liability DECIMAL(20, 6)
) RETURNS TABLE(
    can_place BOOLEAN,
    current_liability DECIMAL(20, 6),
    projected_liability DECIMAL(20, 6),
    payout_cap DECIMAL(20, 6)
) AS $$
DECLARE
    v_current_liability DECIMAL(20, 6);
    v_payout_cap DECIMAL(20, 6);
BEGIN
    -- Obtener liability actual
    SELECT COALESCE(de.total_liability, 0)
    INTO v_current_liability
    FROM daily_exposure de
    WHERE de.day_id = p_day_id
      AND de.bet_type = p_bet_type
      AND de.number = p_number;

    IF v_current_liability IS NULL THEN
        v_current_liability := 0;
    END IF;

    -- Obtener payout cap
    SELECT config_value::DECIMAL INTO v_payout_cap
    FROM risk_config
    WHERE config_key = 'absolute_max_payout';

    RETURN QUERY SELECT
        (v_current_liability + p_new_liability) <= v_payout_cap,
        v_current_liability,
        v_current_liability + p_new_liability,
        v_payout_cap;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Trigger: auto_create_exposure_alert
-- Crear alerta automaticamente si la exposicion es alta
-- ============================================
CREATE OR REPLACE FUNCTION create_exposure_alert_if_needed()
RETURNS TRIGGER AS $$
DECLARE
    v_payout_cap DECIMAL(20, 6);
    v_percentage DECIMAL(5, 2);
    v_alert_level VARCHAR(20);
BEGIN
    SELECT config_value::DECIMAL INTO v_payout_cap
    FROM risk_config
    WHERE config_key = 'absolute_max_payout';

    IF v_payout_cap > 0 THEN
        v_percentage := (NEW.total_liability / v_payout_cap) * 100;

        IF v_percentage >= 100 THEN
            v_alert_level := 'blocked';
        ELSIF v_percentage >= 90 THEN
            v_alert_level := 'critical';
        ELSIF v_percentage >= 70 THEN
            v_alert_level := 'warning';
        ELSE
            RETURN NEW;
        END IF;

        -- Insertar alerta si no existe una reciente
        INSERT INTO exposure_alerts (day_id, bet_type, number, current_liability, payout_cap, percentage_used, alert_level)
        SELECT NEW.day_id, NEW.bet_type, NEW.number, NEW.total_liability, v_payout_cap, v_percentage, v_alert_level
        WHERE NOT EXISTS (
            SELECT 1 FROM exposure_alerts
            WHERE day_id = NEW.day_id
              AND bet_type = NEW.bet_type
              AND number = NEW.number
              AND alert_level = v_alert_level
              AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exposure_alert ON daily_exposure;
CREATE TRIGGER trg_exposure_alert
    AFTER INSERT OR UPDATE ON daily_exposure
    FOR EACH ROW
    EXECUTE FUNCTION create_exposure_alert_if_needed();

-- ============================================
-- Agregar columna day_id a draws si no existe
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'draws' AND column_name = 'day_id'
    ) THEN
        ALTER TABLE draws ADD COLUMN day_id INTEGER;
        UPDATE draws SET day_id = EXTRACT(EPOCH FROM scheduled_time)::INTEGER / 86400;
        CREATE INDEX IF NOT EXISTS idx_draws_day_id ON draws(day_id);
    END IF;
END $$;

-- ============================================
-- Agregar columna day_id a bets si no existe
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bets' AND column_name = 'day_id'
    ) THEN
        ALTER TABLE bets ADD COLUMN day_id INTEGER;
        -- Actualizar day_id basado en el draw
        UPDATE bets b SET day_id = d.day_id FROM draws d WHERE b.draw_id = d.id;
        CREATE INDEX IF NOT EXISTS idx_bets_day_id ON bets(day_id);
    END IF;
END $$;

-- ============================================
-- Comentarios de documentacion
-- ============================================
COMMENT ON TABLE daily_exposure IS 'Tracking de exposicion diaria por numero/tipo de apuesta';
COMMENT ON TABLE daily_settlements IS 'Liquidacion de resultados al final de cada dia';
COMMENT ON TABLE monthly_accounting IS 'Contabilidad mensual y calculo de comisiones del operador';
COMMENT ON TABLE bankroll_snapshots IS 'Historial de estado del bankroll para auditoria';
COMMENT ON TABLE risk_config IS 'Configuracion de parametros de gestion de riesgo';
COMMENT ON TABLE exposure_alerts IS 'Alertas automaticas cuando la exposicion se acerca al limite';
