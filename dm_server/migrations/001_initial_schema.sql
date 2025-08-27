-- DM Server Database Schema

-- Table for storing X25519 public keys for users
CREATE TABLE user_x25519_keys (
    identity_key_type BIGINT NOT NULL,
    identity_key_bytes BYTEA NOT NULL,
    x25519_public_key BYTEA NOT NULL,
    signature BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (identity_key_type, identity_key_bytes)
);

-- Index for fast lookups by identity key
CREATE INDEX idx_user_x25519_keys_identity ON user_x25519_keys (identity_key_type, identity_key_bytes);

-- Table for storing encrypted DM messages
CREATE TABLE dm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR(255) UNIQUE NOT NULL,
    
    -- Sender identity key
    sender_key_type BIGINT NOT NULL,
    sender_key_bytes BYTEA NOT NULL,
    
    -- Recipient identity key  
    recipient_key_type BIGINT NOT NULL,
    recipient_key_bytes BYTEA NOT NULL,
    
    -- Encryption data
    ephemeral_public_key BYTEA NOT NULL,
    encrypted_content BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    message_timestamp TIMESTAMPTZ NOT NULL,
    
    -- Optional reply reference
    reply_to_message_id VARCHAR(255),
    
    -- Delivery tracking
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ
);

-- Indexes for efficient querying
CREATE INDEX idx_dm_messages_sender ON dm_messages (sender_key_type, sender_key_bytes, created_at DESC);
CREATE INDEX idx_dm_messages_recipient ON dm_messages (recipient_key_type, recipient_key_bytes, created_at DESC);
CREATE INDEX idx_dm_messages_conversation ON dm_messages (
    LEAST(sender_key_type, recipient_key_type),
    LEAST(sender_key_bytes, recipient_key_bytes),
    GREATEST(sender_key_type, recipient_key_type), 
    GREATEST(sender_key_bytes, recipient_key_bytes),
    created_at DESC
);
CREATE INDEX idx_dm_messages_message_id ON dm_messages (message_id);
CREATE INDEX idx_dm_messages_reply_to ON dm_messages (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

-- Table for tracking online users and their WebSocket connections
CREATE TABLE active_connections (
    connection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_key_type BIGINT NOT NULL,
    identity_key_bytes BYTEA NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_ping TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT
);

-- Index for fast user lookups
CREATE INDEX idx_active_connections_identity ON active_connections (identity_key_type, identity_key_bytes);
CREATE INDEX idx_active_connections_last_ping ON active_connections (last_ping);

-- Table for message delivery tracking (separate from messages for scalability)
CREATE TABLE message_delivery (
    message_id VARCHAR(255) NOT NULL,
    recipient_key_type BIGINT NOT NULL,
    recipient_key_bytes BYTEA NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'sent', 'delivered', 'read'
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, recipient_key_type, recipient_key_bytes, status)
);

CREATE INDEX idx_message_delivery_recipient ON message_delivery (recipient_key_type, recipient_key_bytes, timestamp DESC);
CREATE INDEX idx_message_delivery_message_id ON message_delivery (message_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for user_x25519_keys table
CREATE TRIGGER update_user_x25519_keys_updated_at 
    BEFORE UPDATE ON user_x25519_keys 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add constraint to ensure nonce is correct length (24 bytes for ChaCha20Poly1305)
ALTER TABLE dm_messages ADD CONSTRAINT chk_nonce_length CHECK (octet_length(nonce) = 24);

-- Add constraint to ensure ephemeral key is correct length (32 bytes for X25519)  
ALTER TABLE dm_messages ADD CONSTRAINT chk_ephemeral_key_length CHECK (octet_length(ephemeral_public_key) = 32);

-- Add constraint to ensure X25519 key is correct length
ALTER TABLE user_x25519_keys ADD CONSTRAINT chk_x25519_key_length CHECK (octet_length(x25519_public_key) = 32);
