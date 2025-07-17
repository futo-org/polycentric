-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Add banned users table
CREATE TABLE banned_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    public_key BYTEA NOT NULL UNIQUE,
    banned_by BYTEA NOT NULL, -- Admin who banned the user
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX idx_banned_users_public_key ON banned_users(public_key);

-- Add comment for documentation
COMMENT ON TABLE banned_users IS 'Stores banned user public keys with admin who banned them and reason'; 