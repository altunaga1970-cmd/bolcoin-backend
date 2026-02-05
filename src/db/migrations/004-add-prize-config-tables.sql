-- =================================
-- PRIZE CONFIGURATION TABLES
-- Migration 004
-- =================================

-- Prize configurations table (for dynamic overrides)
CREATE TABLE IF NOT EXISTS prize_configs (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    updated_by VARCHAR(42),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prize config history (audit trail)
CREATE TABLE IF NOT EXISTS prize_config_history (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL,
    old_value JSONB,
    new_value JSONB NOT NULL,
    changed_by VARCHAR(42),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reason TEXT
);

-- Jackpot status tracking
CREATE TABLE IF NOT EXISTS jackpot_status (
    id SERIAL PRIMARY KEY,
    jackpot_amount DECIMAL(18, 2) NOT NULL,
    reason VARCHAR(50) NOT NULL,
    actor_address VARCHAR(42),
    draw_id INTEGER REFERENCES draws(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to log config changes
CREATE OR REPLACE FUNCTION log_prize_config_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO prize_config_history (key, old_value, new_value, changed_by, reason)
        VALUES (NEW.key, NULL, NEW.value, NEW.updated_by, 'initial');
    ELSIF TG_OP = 'UPDATE' AND OLD.value IS DISTINCT FROM NEW.value THEN
        INSERT INTO prize_config_history (key, old_value, new_value, changed_by, reason)
        VALUES (NEW.key, OLD.value, NEW.value, NEW.updated_by, 'update');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS prize_config_change_trigger ON prize_configs;

CREATE TRIGGER prize_config_change_trigger
AFTER INSERT OR UPDATE ON prize_configs
FOR EACH ROW
EXECUTE FUNCTION log_prize_config_change();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prize_configs_key ON prize_configs(key);
CREATE INDEX IF NOT EXISTS idx_prize_configs_active ON prize_configs(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_prize_config_history_key ON prize_config_history(key);
CREATE INDEX IF NOT EXISTS idx_prize_config_history_date ON prize_config_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_jackpot_status_date ON jackpot_status(updated_at);
CREATE INDEX IF NOT EXISTS idx_jackpot_status_draw ON jackpot_status(draw_id);

-- Insert default jackpot status
INSERT INTO jackpot_status (jackpot_amount, reason, actor_address)
VALUES (10000, 'initial', 'system')
ON CONFLICT DO NOTHING;

-- Insert default prize configurations
INSERT INTO prize_configs (key, value, description, updated_by)
VALUES
    ('lottery_ticket_price', '1', 'Price per lottery ticket in USDT', 'system'),
    ('lottery_jackpot_cap', '1000000', 'Maximum jackpot amount in USDT', 'system'),
    ('lottery_claims_period_days', '30', 'Days to claim lottery prizes', 'system')
ON CONFLICT (key) DO NOTHING;

-- =================================
-- COMMENTS
-- =================================

COMMENT ON TABLE prize_configs IS 'Dynamic prize configuration overrides';
COMMENT ON TABLE prize_config_history IS 'Audit trail for configuration changes';
COMMENT ON TABLE jackpot_status IS 'Jackpot amount tracking over time';
