-- Migration: Add wallet_address column to users table for Web3 authentication
-- Run: psql -d labolita_db -f backend/src/db/migrations/009-add-wallet-address.sql

-- Add wallet_address column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'users' AND column_name = 'wallet_address') THEN
        ALTER TABLE users ADD COLUMN wallet_address VARCHAR(42) UNIQUE;
        CREATE INDEX idx_users_wallet_address ON users(wallet_address);
        COMMENT ON COLUMN users.wallet_address IS 'Ethereum wallet address for Web3 authentication';
    END IF;
END $$;

-- Make username nullable for Web3-only users
ALTER TABLE users ALTER COLUMN username DROP NOT NULL;

-- Add default for username if null (for Web3 users)
ALTER TABLE users ALTER COLUMN username SET DEFAULT NULL;

SELECT 'Migration 009 completed: wallet_address column added' as status;
