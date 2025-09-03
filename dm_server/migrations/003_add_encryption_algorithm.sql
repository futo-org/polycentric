-- Add encryption algorithm field to support both ChaCha20-Poly1305 and AES-GCM
-- This allows the server to handle messages encrypted with different algorithms

-- Add the encryption algorithm column
ALTER TABLE dm_messages ADD COLUMN encryption_algorithm VARCHAR(20) NOT NULL DEFAULT 'ChaCha20Poly1305';

-- Add constraint to ensure valid algorithm values
ALTER TABLE dm_messages ADD CONSTRAINT chk_encryption_algorithm 
    CHECK (encryption_algorithm IN ('ChaCha20Poly1305', 'Aes256Gcm'));

-- Create index for efficient algorithm-based queries
CREATE INDEX idx_dm_messages_algorithm ON dm_messages (encryption_algorithm);

-- Update existing messages to use the default algorithm
UPDATE dm_messages SET encryption_algorithm = 'ChaCha20Poly1305' WHERE encryption_algorithm IS NULL;
