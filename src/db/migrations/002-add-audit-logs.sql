-- Migration: Add audit_logs table and VRF fields to draws
-- Created: 2024

-- =================================
-- TABLA DE AUDIT LOGS
-- =================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(30) NOT NULL,
    entity_id VARCHAR(100),
    actor_address VARCHAR(42) NOT NULL DEFAULT 'system',
    details JSONB DEFAULT '{}',
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices para búsquedas eficientes
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_address);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- =================================
-- NUEVOS CAMPOS EN DRAWS PARA VRF
-- =================================

-- Añadir campos VRF a la tabla draws si no existen
DO $$
BEGIN
    -- vrf_request_id: ID de la solicitud VRF
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='vrf_request_id') THEN
        ALTER TABLE draws ADD COLUMN vrf_request_id VARCHAR(100);
    END IF;

    -- vrf_random_word: Número aleatorio recibido de VRF
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='vrf_random_word') THEN
        ALTER TABLE draws ADD COLUMN vrf_random_word VARCHAR(100);
    END IF;

    -- vrf_requested_at: Timestamp de solicitud VRF
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='vrf_requested_at') THEN
        ALTER TABLE draws ADD COLUMN vrf_requested_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- vrf_fulfilled_at: Timestamp de respuesta VRF
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='vrf_fulfilled_at') THEN
        ALTER TABLE draws ADD COLUMN vrf_fulfilled_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- merkle_root: Root del Merkle tree de ganadores (para La Fortuna)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='merkle_root') THEN
        ALTER TABLE draws ADD COLUMN merkle_root VARCHAR(66);
    END IF;

    -- claims_deadline: Fecha límite para claims
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='claims_deadline') THEN
        ALTER TABLE draws ADD COLUMN claims_deadline TIMESTAMP WITH TIME ZONE;
    END IF;

    -- draw_type: Tipo de sorteo (bolita, lottery)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='draw_type') THEN
        ALTER TABLE draws ADD COLUMN draw_type VARCHAR(20) DEFAULT 'bolita';
    END IF;

    -- lottery_numbers: Números ganadores de La Fortuna (JSON array)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='lottery_numbers') THEN
        ALTER TABLE draws ADD COLUMN lottery_numbers JSONB;
    END IF;

    -- lottery_key: Número clave de La Fortuna
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='draws' AND column_name='lottery_key') THEN
        ALTER TABLE draws ADD COLUMN lottery_key INTEGER;
    END IF;
END $$;

-- Índice para búsqueda por tipo de sorteo
CREATE INDEX IF NOT EXISTS idx_draws_type ON draws(draw_type);

-- =================================
-- TABLA DE VRF REQUESTS (para tracking)
-- =================================

CREATE TABLE IF NOT EXISTS vrf_requests (
    id SERIAL PRIMARY KEY,
    draw_id INTEGER REFERENCES draws(id),
    request_id VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, fulfilled, failed, timeout
    random_word VARCHAR(100),
    tx_hash VARCHAR(66),
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    fulfilled_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_vrf_requests_draw ON vrf_requests(draw_id);
CREATE INDEX IF NOT EXISTS idx_vrf_requests_status ON vrf_requests(status);
