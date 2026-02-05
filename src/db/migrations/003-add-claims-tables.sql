-- Migration: Add claims system tables
-- For La Fortuna lottery prize claims using Merkle proofs

-- =================================
-- TABLA DE MERKLE ROOTS
-- =================================

CREATE TABLE IF NOT EXISTS merkle_roots (
    id SERIAL PRIMARY KEY,
    draw_id INTEGER NOT NULL REFERENCES draws(id),
    root_hash VARCHAR(66) NOT NULL,
    tree_data JSONB NOT NULL,           -- Árbol completo para generar proofs
    total_winners INTEGER DEFAULT 0,
    total_prize_amount DECIMAL(18,6) DEFAULT 0,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    published_by VARCHAR(42),            -- Wallet del admin que publicó
    tx_hash VARCHAR(66),                 -- Hash de tx on-chain (si aplica)
    status VARCHAR(20) DEFAULT 'active', -- active, expired, revoked
    expires_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(draw_id)
);

CREATE INDEX IF NOT EXISTS idx_merkle_roots_draw ON merkle_roots(draw_id);
CREATE INDEX IF NOT EXISTS idx_merkle_roots_status ON merkle_roots(status);

-- =================================
-- TABLA DE CLAIMS
-- =================================

CREATE TABLE IF NOT EXISTS claims (
    id SERIAL PRIMARY KEY,
    draw_id INTEGER NOT NULL REFERENCES draws(id),
    user_address VARCHAR(42) NOT NULL,
    ticket_id VARCHAR(100),              -- ID del ticket ganador
    category INTEGER NOT NULL,           -- Categoría de premio (1-5)
    prize_amount DECIMAL(18,6) NOT NULL,
    merkle_proof JSONB NOT NULL,         -- Array de hashes del proof
    leaf_hash VARCHAR(66) NOT NULL,      -- Hash de la hoja del árbol
    status VARCHAR(20) DEFAULT 'pending', -- pending, claimed, expired, failed
    claimed_at TIMESTAMP WITH TIME ZONE,
    claim_tx_hash VARCHAR(66),           -- Hash de tx del claim on-chain
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT,
    UNIQUE(draw_id, user_address, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_claims_draw ON claims(draw_id);
CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_address);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);

-- =================================
-- TABLA DE WINNERS (ganadores calculados)
-- =================================

CREATE TABLE IF NOT EXISTS lottery_winners (
    id SERIAL PRIMARY KEY,
    draw_id INTEGER NOT NULL REFERENCES draws(id),
    user_address VARCHAR(42) NOT NULL,
    ticket_id VARCHAR(100) NOT NULL,
    ticket_numbers JSONB NOT NULL,       -- Array de 6 números
    ticket_key INTEGER NOT NULL,         -- Número clave
    matches INTEGER NOT NULL,            -- Cantidad de aciertos
    key_match BOOLEAN DEFAULT FALSE,     -- Si acertó la clave
    category INTEGER NOT NULL,           -- Categoría de premio
    prize_amount DECIMAL(18,6) NOT NULL,
    claim_status VARCHAR(20) DEFAULT 'unclaimed', -- unclaimed, claimed, expired
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(draw_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_lottery_winners_draw ON lottery_winners(draw_id);
CREATE INDEX IF NOT EXISTS idx_lottery_winners_user ON lottery_winners(user_address);
CREATE INDEX IF NOT EXISTS idx_lottery_winners_category ON lottery_winners(category);

-- =================================
-- TABLA DE TICKETS DE LOTERÍA
-- =================================

CREATE TABLE IF NOT EXISTS lottery_tickets (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(100) NOT NULL UNIQUE,
    draw_id INTEGER NOT NULL REFERENCES draws(id),
    user_address VARCHAR(42) NOT NULL,
    numbers JSONB NOT NULL,              -- Array de 6 números
    key_number INTEGER NOT NULL,
    price DECIMAL(18,6) NOT NULL,
    tx_hash VARCHAR(66),                 -- Hash de tx de compra
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active'  -- active, winner, loser, refunded
);

CREATE INDEX IF NOT EXISTS idx_lottery_tickets_draw ON lottery_tickets(draw_id);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_user ON lottery_tickets(user_address);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_status ON lottery_tickets(status);
