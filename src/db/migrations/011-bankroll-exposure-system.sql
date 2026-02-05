-- =================================
-- MIGRACIÓN: Sistema de Bankroll y Exposición por Número
-- Fecha: 2026-01-27
-- =================================

-- ============================================
-- Tabla: bankroll_status
-- Estado global del bankroll y límites
-- ============================================
CREATE TABLE IF NOT EXISTS bankroll_status (
    id SERIAL PRIMARY KEY,
    bankroll_balance DECIMAL(14, 2) DEFAULT 0.00,          -- Fondo para aumentar límites
    prize_reserve DECIMAL(14, 2) DEFAULT 1000.00,          -- Reserva para pagar premios
    current_limit_per_number DECIMAL(10, 2) DEFAULT 2.00,  -- Límite actual por número
    min_limit_per_number DECIMAL(10, 2) DEFAULT 2.00,      -- Límite mínimo inicial
    max_limit_per_number DECIMAL(10, 2) DEFAULT 1000.00,   -- Límite máximo objetivo
    total_bets_processed DECIMAL(14, 2) DEFAULT 0.00,      -- Total apostado histórico
    total_prizes_paid DECIMAL(14, 2) DEFAULT 0.00,         -- Total premios pagados
    total_fees_collected DECIMAL(14, 2) DEFAULT 0.00,      -- Total fees cobrados
    last_limit_update TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar registro inicial
INSERT INTO bankroll_status (
    bankroll_balance,
    prize_reserve,
    current_limit_per_number
) VALUES (0.00, 1000.00, 2.00)
ON CONFLICT DO NOTHING;

-- ============================================
-- Tabla: number_exposure
-- Tracking de exposición por número por sorteo
-- ============================================
CREATE TABLE IF NOT EXISTS number_exposure (
    id SERIAL PRIMARY KEY,
    draw_id INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
    game_type VARCHAR(20) NOT NULL CHECK (game_type IN ('fijos', 'centenas', 'parles')),
    bet_number VARCHAR(4) NOT NULL,
    total_amount DECIMAL(10, 2) DEFAULT 0.00,              -- Total apostado a este número
    exposure_limit DECIMAL(10, 2) NOT NULL,                -- Límite vigente al momento
    potential_payout DECIMAL(14, 2) DEFAULT 0.00,          -- Pago potencial si gana
    is_sold_out BOOLEAN DEFAULT false,                     -- True cuando alcanza el límite
    bets_count INTEGER DEFAULT 0,                          -- Cantidad de apuestas
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Un número solo puede existir una vez por sorteo y tipo
    UNIQUE(draw_id, game_type, bet_number)
);

CREATE INDEX IF NOT EXISTS idx_number_exposure_draw ON number_exposure(draw_id);
CREATE INDEX IF NOT EXISTS idx_number_exposure_number ON number_exposure(bet_number);
CREATE INDEX IF NOT EXISTS idx_number_exposure_sold ON number_exposure(draw_id, is_sold_out);

-- ============================================
-- Tabla: bankroll_transactions
-- Historial de movimientos del bankroll
-- ============================================
CREATE TABLE IF NOT EXISTS bankroll_transactions (
    id SERIAL PRIMARY KEY,
    draw_id INTEGER REFERENCES draws(id),
    transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN (
        'fee_collection',           -- 5% fee al operador
        'prize_reserve_add',        -- Aporte a reserva de premios
        'prize_payout',             -- Pago de premio
        'bankroll_add',             -- Aporte al bankroll
        'limit_increase',           -- Registro de aumento de límite
        'initial_capital',          -- Capital inicial
        'manual_adjustment'         -- Ajuste manual
    )),
    amount DECIMAL(14, 2) NOT NULL,
    balance_before DECIMAL(14, 2) NOT NULL,
    balance_after DECIMAL(14, 2) NOT NULL,
    target_fund VARCHAR(20) CHECK (target_fund IN ('bankroll', 'reserve', 'operator')),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bankroll_tx_draw ON bankroll_transactions(draw_id);
CREATE INDEX IF NOT EXISTS idx_bankroll_tx_type ON bankroll_transactions(transaction_type);

-- ============================================
-- Tabla: draw_settlement
-- Resumen de liquidación por sorteo
-- ============================================
CREATE TABLE IF NOT EXISTS draw_settlement (
    id SERIAL PRIMARY KEY,
    draw_id INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE UNIQUE,

    -- Pool y resultados
    total_pool DECIMAL(14, 2) NOT NULL,                    -- Total apostado en el sorteo
    has_winner BOOLEAN DEFAULT false,                      -- Si hubo ganador

    -- Números ganadores
    winning_fijo VARCHAR(2),
    winning_centena VARCHAR(3),
    winning_parle VARCHAR(4),

    -- Premios pagados
    fijo_winners_count INTEGER DEFAULT 0,
    fijo_total_payout DECIMAL(14, 2) DEFAULT 0.00,
    centena_winners_count INTEGER DEFAULT 0,
    centena_total_payout DECIMAL(14, 2) DEFAULT 0.00,
    parle_winners_count INTEGER DEFAULT 0,
    parle_total_payout DECIMAL(14, 2) DEFAULT 0.00,
    total_prizes_paid DECIMAL(14, 2) DEFAULT 0.00,

    -- Distribución del pool
    fee_amount DECIMAL(14, 2) DEFAULT 0.00,                -- 5% siempre
    to_reserve DECIMAL(14, 2) DEFAULT 0.00,                -- 65% con ganador, 45% sin
    to_bankroll DECIMAL(14, 2) DEFAULT 0.00,               -- 30% con ganador, 50% sin

    -- Estado del sistema después
    new_bankroll_balance DECIMAL(14, 2),
    new_reserve_balance DECIMAL(14, 2),
    new_limit_per_number DECIMAL(10, 2),

    settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_draw_settlement_draw ON draw_settlement(draw_id);

-- ============================================
-- Actualizar game_settings con nuevos valores
-- ============================================
DELETE FROM game_settings WHERE setting_key IN (
    'fijos_multiplier',
    'centenas_multiplier',
    'parles_multiplier',
    'max_bet_amount',
    'min_bet_amount'
);

INSERT INTO game_settings (setting_key, setting_value, description) VALUES
    ('fijos_multiplier', '65', 'Multiplicador de pago para Fijos (2 dígitos) - 65x'),
    ('centenas_multiplier', '300', 'Multiplicador de pago para Centenas (3 dígitos) - 300x'),
    ('parles_multiplier', '1000', 'Multiplicador de pago para Parles (4 dígitos) - 1000x'),
    ('initial_limit_per_number', '2', 'Límite inicial por número en USDT'),
    ('max_limit_per_number', '1000', 'Límite máximo por número en USDT'),
    ('fee_percentage', '5', 'Porcentaje de fee del operador'),
    ('reserve_pct_with_winner', '65', 'Porcentaje a reserva cuando hay ganador'),
    ('bankroll_pct_with_winner', '30', 'Porcentaje a bankroll cuando hay ganador'),
    ('reserve_pct_no_winner', '45', 'Porcentaje a reserva cuando no hay ganador'),
    ('bankroll_pct_no_winner', '50', 'Porcentaje a bankroll cuando no hay ganador')
ON CONFLICT (setting_key) DO UPDATE SET
    setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================
-- Función: Obtener espacio disponible para apostar
-- ============================================
CREATE OR REPLACE FUNCTION get_available_amount(
    p_draw_id INTEGER,
    p_game_type VARCHAR(20),
    p_bet_number VARCHAR(4)
) RETURNS DECIMAL(10, 2) AS $$
DECLARE
    v_limit DECIMAL(10, 2);
    v_current_amount DECIMAL(10, 2);
BEGIN
    -- Obtener límite actual
    SELECT current_limit_per_number INTO v_limit FROM bankroll_status LIMIT 1;

    -- Obtener monto ya apostado a este número
    SELECT COALESCE(total_amount, 0) INTO v_current_amount
    FROM number_exposure
    WHERE draw_id = p_draw_id
      AND game_type = p_game_type
      AND bet_number = p_bet_number;

    IF v_current_amount IS NULL THEN
        v_current_amount := 0;
    END IF;

    RETURN GREATEST(0, v_limit - v_current_amount);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Función: Verificar si número está vendido
-- ============================================
CREATE OR REPLACE FUNCTION is_number_sold_out(
    p_draw_id INTEGER,
    p_game_type VARCHAR(20),
    p_bet_number VARCHAR(4)
) RETURNS BOOLEAN AS $$
DECLARE
    v_available DECIMAL(10, 2);
BEGIN
    v_available := get_available_amount(p_draw_id, p_game_type, p_bet_number);
    RETURN v_available <= 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Función: Calcular nuevo límite basado en bankroll
-- ============================================
CREATE OR REPLACE FUNCTION calculate_new_limit(
    p_bankroll DECIMAL(14, 2),
    p_reserve DECIMAL(14, 2)
) RETURNS DECIMAL(10, 2) AS $$
DECLARE
    v_min_limit DECIMAL(10, 2) := 2.00;
    v_max_limit DECIMAL(10, 2) := 1000.00;
    v_total_funds DECIMAL(14, 2);
    v_max_exposure DECIMAL(14, 2);
    v_new_limit DECIMAL(10, 2);
BEGIN
    -- Total de fondos disponibles
    v_total_funds := p_bankroll + p_reserve;

    -- El límite se calcula para que la exposición máxima
    -- (si todos los números de un tipo ganan) sea cubierta por la reserva
    -- Fórmula: límite = reserva / (multiplicador_max * factor_seguridad)
    -- Factor de seguridad = 3 (asumiendo que máximo 3 números podrían ganar simultáneamente)
    -- Multiplicador máximo = 1000 (parle)

    v_new_limit := p_reserve / 3000; -- reserva / (1000 * 3)

    -- También consideramos el bankroll como indicador de crecimiento
    -- Por cada 500 USDT en bankroll, el límite sube 1 USDT
    v_new_limit := v_new_limit + (p_bankroll / 500);

    -- Aplicar mínimo y máximo
    v_new_limit := GREATEST(v_min_limit, LEAST(v_max_limit, v_new_limit));

    -- Redondear a 2 decimales
    RETURN ROUND(v_new_limit, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Trigger: Actualizar updated_at en bankroll_status
-- ============================================
CREATE TRIGGER update_bankroll_status_updated_at
    BEFORE UPDATE ON bankroll_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Trigger: Actualizar updated_at en number_exposure
-- ============================================
CREATE TRIGGER update_number_exposure_updated_at
    BEFORE UPDATE ON number_exposure
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Vista: Números vendidos por sorteo
-- ============================================
CREATE OR REPLACE VIEW sold_out_numbers AS
SELECT
    ne.draw_id,
    d.draw_number,
    ne.game_type,
    ne.bet_number,
    ne.total_amount,
    ne.exposure_limit,
    ne.potential_payout,
    ne.bets_count
FROM number_exposure ne
JOIN draws d ON ne.draw_id = d.id
WHERE ne.is_sold_out = true
ORDER BY ne.draw_id, ne.game_type, ne.bet_number;

-- ============================================
-- Vista: Estado actual del sistema
-- ============================================
CREATE OR REPLACE VIEW system_status AS
SELECT
    bs.bankroll_balance,
    bs.prize_reserve,
    bs.current_limit_per_number,
    bs.min_limit_per_number,
    bs.max_limit_per_number,
    bs.total_bets_processed,
    bs.total_prizes_paid,
    bs.total_fees_collected,
    bs.last_limit_update,
    (SELECT COUNT(*) FROM draws WHERE status = 'open') as open_draws,
    (SELECT COUNT(*) FROM number_exposure WHERE is_sold_out = true) as sold_out_numbers_count
FROM bankroll_status bs
LIMIT 1;

-- ============================================
-- FIN DE LA MIGRACIÓN
-- ============================================
