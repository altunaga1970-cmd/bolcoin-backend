-- ===========================================
-- Migration 007: Create operator_fees table for tracking fees
-- ===========================================

CREATE TABLE IF NOT EXISTS operator_fees (
    id SERIAL PRIMARY KEY,
    draw_id INTEGER REFERENCES draws(id),
    draw_type VARCHAR(20) NOT NULL, -- 'bolita' or 'lottery'
    pool_amount DECIMAL(20, 6) NOT NULL, -- Total pool amount
    fee_percentage DECIMAL(5, 2) NOT NULL, -- Fee percentage (e.g., 20.00 for 20%)
    fee_amount DECIMAL(20, 6) NOT NULL, -- Calculated fee
    operator_wallet VARCHAR(42) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'transferred', 'failed'
    transfer_tx_hash VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    transferred_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT operator_fees_status_check CHECK (status IN ('pending', 'transferred', 'failed'))
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_operator_fees_draw_id ON operator_fees(draw_id);
CREATE INDEX IF NOT EXISTS idx_operator_fees_status ON operator_fees(status);
CREATE INDEX IF NOT EXISTS idx_operator_fees_created_at ON operator_fees(created_at);

-- View for pending fees summary
CREATE OR REPLACE VIEW pending_operator_fees AS
SELECT
    operator_wallet,
    draw_type,
    COUNT(*) as pending_count,
    SUM(fee_amount) as total_pending
FROM operator_fees
WHERE status = 'pending'
GROUP BY operator_wallet, draw_type;
