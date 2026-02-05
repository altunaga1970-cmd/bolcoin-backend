-- ===========================================
-- Migration 006: Add winning number columns for La Bolita
-- ===========================================

-- Add columns for storing winning numbers breakdown
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'winning_fijos') THEN
        ALTER TABLE draws ADD COLUMN winning_fijos VARCHAR(2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'winning_centenas') THEN
        ALTER TABLE draws ADD COLUMN winning_centenas VARCHAR(3);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'winning_parles') THEN
        ALTER TABLE draws ADD COLUMN winning_parles VARCHAR(4);
    END IF;

    -- For lottery draws
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'lottery_numbers') THEN
        ALTER TABLE draws ADD COLUMN lottery_numbers INTEGER[];
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'draws' AND column_name = 'lottery_key') THEN
        ALTER TABLE draws ADD COLUMN lottery_key INTEGER;
    END IF;
END $$;
