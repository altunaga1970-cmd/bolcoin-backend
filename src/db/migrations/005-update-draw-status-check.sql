-- ===========================================
-- Migration 005: Update draws status constraint for VRF workflow
-- ===========================================

-- Drop the old constraint
ALTER TABLE draws DROP CONSTRAINT IF EXISTS draws_status_check;

-- Add the new constraint with all VRF-related statuses
ALTER TABLE draws ADD CONSTRAINT draws_status_check
    CHECK (status IN (
        'scheduled',      -- Sorteo programado, aun no abierto
        'open',           -- Abierto para apuestas
        'closed',         -- Cerrado, esperando resultado
        'vrf_requested',  -- VRF solicitado a Chainlink
        'vrf_fulfilled',  -- VRF recibido, listo para procesar
        'settled',        -- Resultados calculados
        'roots_published', -- Merkle roots publicados
        'claims_open',    -- Claims abiertos
        'completed',      -- Sorteo completado
        'cancelled'       -- Sorteo cancelado
    ));

-- Add columns for VRF tracking if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'vrf_request_id') THEN
        ALTER TABLE draws ADD COLUMN vrf_request_id VARCHAR(100);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'vrf_requested_at') THEN
        ALTER TABLE draws ADD COLUMN vrf_requested_at TIMESTAMP WITH TIME ZONE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'vrf_fulfilled_at') THEN
        ALTER TABLE draws ADD COLUMN vrf_fulfilled_at TIMESTAMP WITH TIME ZONE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'vrf_random_number') THEN
        ALTER TABLE draws ADD COLUMN vrf_random_number VARCHAR(100);
    END IF;
END $$;

-- Create index on status for scheduler queries
CREATE INDEX IF NOT EXISTS idx_draws_status ON draws(status);
CREATE INDEX IF NOT EXISTS idx_draws_scheduled_time ON draws(scheduled_time);
