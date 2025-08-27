-- Fix nonce length constraint for ChaCha20Poly1305
-- ChaCha20Poly1305 uses 12-byte nonces, not 24-byte nonces

-- Drop the incorrect constraint
ALTER TABLE dm_messages DROP CONSTRAINT chk_nonce_length;

-- Add the correct constraint (12 bytes for ChaCha20Poly1305)
ALTER TABLE dm_messages ADD CONSTRAINT chk_nonce_length CHECK (octet_length(nonce) = 12);
