-- Enable UUID and pgcrypto for uuid v7
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION public.uuid_generate_v7() RETURNS uuid AS $$
DECLARE
    ts BIGINT;
    uuid_bytes BYTEA;
    ts_bytes BYTEA;
    random_bytes BYTEA;
BEGIN
    ts := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
    ts_bytes := decode(lpad(to_hex(ts), 12, '0'), 'hex');
    random_bytes := gen_random_bytes(10);
    uuid_bytes := ts_bytes || random_bytes;
    uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
    uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
    RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Add banned users table
CREATE TABLE banned_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    public_key BYTEA NOT NULL UNIQUE,
    banned_by BYTEA NOT NULL, -- Admin who banned the user
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX idx_banned_users_public_key ON banned_users(public_key);

-- Add comment for documentation
COMMENT ON TABLE banned_users IS 'Stores banned user public keys with admin who banned them and reason'; 