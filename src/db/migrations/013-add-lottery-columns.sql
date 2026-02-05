-- Migration 013: Add lottery columns to draws table
-- For storing La Fortuna lottery winning numbers

DO $$
BEGIN
    -- Add lottery_numbers column (array of 6 integers)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'lottery_numbers') THEN
        ALTER TABLE draws ADD COLUMN lottery_numbers INTEGER[];
        RAISE NOTICE 'Added lottery_numbers column to draws table';
    END IF;

    -- Add lottery_key column (integer 0-9)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'lottery_key') THEN
        ALTER TABLE draws ADD COLUMN lottery_key INTEGER;
        RAISE NOTICE 'Added lottery_key column to draws table';
    END IF;

    -- Add total_tickets column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'total_tickets') THEN
        ALTER TABLE draws ADD COLUMN total_tickets INTEGER DEFAULT 0;
        RAISE NOTICE 'Added total_tickets column to draws table';
    END IF;
END $$;

-- Create lottery_tickets table for La Fortuna tickets
CREATE TABLE IF NOT EXISTS lottery_tickets (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) UNIQUE NOT NULL,
    draw_id INTEGER REFERENCES draws(id) ON DELETE CASCADE,
    user_address VARCHAR(42) NOT NULL,
    numbers JSONB NOT NULL,  -- Array of 6 numbers [1-49]
    key_number INTEGER NOT NULL CHECK (key_number >= 0 AND key_number <= 9),
    price DECIMAL(10,2) DEFAULT 1.00,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'claimed')),
    matches INTEGER DEFAULT 0,  -- Number of matching numbers (0-6)
    key_match BOOLEAN DEFAULT FALSE,  -- Whether key number matched
    prize_amount DECIMAL(14,2) DEFAULT 0,
    claimed_at TIMESTAMP,
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for lottery_tickets
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_draw ON lottery_tickets(draw_id);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_user ON lottery_tickets(user_address);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_status ON lottery_tickets(status);

-- Create jackpot_status table for tracking jackpot amount
CREATE TABLE IF NOT EXISTS jackpot_status (
    id SERIAL PRIMARY KEY,
    jackpot_amount DECIMAL(14,2) DEFAULT 0,
    last_won_at TIMESTAMP,
    last_won_by VARCHAR(42),
    last_won_draw_id INTEGER REFERENCES draws(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial jackpot if not exists
INSERT INTO jackpot_status (jackpot_amount)
SELECT 10000
WHERE NOT EXISTS (SELECT 1 FROM jackpot_status);

COMMENT ON TABLE lottery_tickets IS 'Tickets for La Fortuna lottery (6+1 format)';
COMMENT ON TABLE jackpot_status IS 'Current jackpot status for La Fortuna';
