use anyhow::{anyhow, Result};
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use x25519_dalek::{EphemeralSecret, PublicKey as X25519PublicKey, StaticSecret};

/// Encryption utilities for end-to-end encrypted direct messages
pub struct DMCrypto;

impl DMCrypto {
    /// Generate a new X25519 keypair for DM encryption
    pub fn generate_x25519_keypair() -> (StaticSecret, X25519PublicKey) {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public = X25519PublicKey::from(&secret);
        (secret, public)
    }

    /// Generate an ephemeral X25519 keypair for a single message
    pub fn generate_ephemeral_keypair() -> (EphemeralSecret, X25519PublicKey) {
        let secret = EphemeralSecret::random_from_rng(OsRng);
        let public = X25519PublicKey::from(&secret);
        (secret, public)
    }

    /// Sign data with an Ed25519 private key
    pub fn sign_data(signing_key: &SigningKey, data: &[u8]) -> Vec<u8> {
        signing_key.sign(data).to_bytes().to_vec()
    }

    /// Verify a signature with an Ed25519 public key
    pub fn verify_signature(
        verifying_key: &VerifyingKey,
        data: &[u8],
        signature: &[u8],
    ) -> Result<()> {
        let signature = Signature::from_slice(signature)
            .map_err(|e| anyhow!("Invalid signature format: {}", e))?;

        verifying_key
            .verify(data, &signature)
            .map_err(|e| anyhow!("Signature verification failed: {}", e))
    }

    /// Encrypt a message using X25519 ECDH + ChaCha20Poly1305
    ///
    /// # Arguments
    /// * `message` - Plain text message to encrypt
    /// * `ephemeral_secret` - Sender's ephemeral private key
    /// * `recipient_public` - Recipient's X25519 public key
    ///
    /// # Returns
    /// * `(encrypted_data, nonce)` - The encrypted message and nonce used
    pub fn encrypt_message(
        message: &[u8],
        ephemeral_secret: EphemeralSecret,
        recipient_public: &X25519PublicKey,
    ) -> Result<(Vec<u8>, Vec<u8>)> {
        // Perform ECDH to get shared secret
        let shared_secret = ephemeral_secret.diffie_hellman(recipient_public);

        // Use the shared secret as encryption key
        let cipher = ChaCha20Poly1305::new_from_slice(shared_secret.as_bytes())
            .map_err(|e| anyhow!("Failed to create cipher: {}", e))?;

        // Generate a random nonce
        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);

        // Encrypt the message
        let encrypted = cipher
            .encrypt(&nonce, message)
            .map_err(|e| anyhow!("Encryption failed: {}", e))?;

        Ok((encrypted, nonce.to_vec()))
    }

    /// Decrypt a message using X25519 ECDH + ChaCha20Poly1305
    ///
    /// # Arguments
    /// * `encrypted_data` - The encrypted message
    /// * `nonce` - The nonce used for encryption
    /// * `recipient_secret` - Recipient's X25519 private key
    /// * `ephemeral_public` - Sender's ephemeral public key
    ///
    /// # Returns
    /// * Decrypted plain text message
    pub fn decrypt_message(
        encrypted_data: &[u8],
        nonce: &[u8],
        recipient_secret: &StaticSecret,
        ephemeral_public: &X25519PublicKey,
    ) -> Result<Vec<u8>> {
        // Perform ECDH to get shared secret
        let shared_secret = recipient_secret.diffie_hellman(ephemeral_public);

        // Use the shared secret as decryption key
        let cipher = ChaCha20Poly1305::new_from_slice(shared_secret.as_bytes())
            .map_err(|e| anyhow!("Failed to create cipher: {}", e))?;

        // Convert nonce
        let nonce = Nonce::from_slice(nonce);

        // Decrypt the message
        let decrypted = cipher
            .decrypt(nonce, encrypted_data)
            .map_err(|e| anyhow!("Decryption failed: {}", e))?;

        Ok(decrypted)
    }

    /// Generate a random challenge for authentication
    pub fn generate_challenge() -> [u8; 32] {
        let mut challenge = [0u8; 32];
        challenge.copy_from_slice(&rand::random::<[u8; 32]>());
        challenge
    }

    /// Convert Ed25519 private key bytes to SigningKey
    pub fn signing_key_from_bytes(bytes: &[u8]) -> Result<SigningKey> {
        if bytes.len() != 32 {
            return Err(anyhow!("Ed25519 private key must be 32 bytes"));
        }

        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(bytes);

        Ok(SigningKey::from_bytes(&key_bytes))
    }

    /// Convert Ed25519 public key bytes to VerifyingKey
    pub fn verifying_key_from_bytes(bytes: &[u8]) -> Result<VerifyingKey> {
        if bytes.len() != 32 {
            return Err(anyhow!("Ed25519 public key must be 32 bytes"));
        }

        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(bytes);

        VerifyingKey::from_bytes(&key_bytes)
            .map_err(|e| anyhow!("Invalid Ed25519 public key: {}", e))
    }

    /// Convert X25519 public key bytes to X25519PublicKey
    pub fn x25519_public_from_bytes(bytes: &[u8]) -> Result<X25519PublicKey> {
        if bytes.len() != 32 {
            return Err(anyhow!("X25519 public key must be 32 bytes"));
        }

        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(bytes);

        Ok(X25519PublicKey::from(key_bytes))
    }

    /// Convert X25519 private key bytes to StaticSecret
    pub fn x25519_secret_from_bytes(bytes: &[u8]) -> Result<StaticSecret> {
        if bytes.len() != 32 {
            return Err(anyhow!("X25519 private key must be 32 bytes"));
        }

        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(bytes);

        Ok(StaticSecret::from(key_bytes))
    }

    /// Convert StaticSecret to bytes
    pub fn x25519_secret_to_bytes(secret: &StaticSecret) -> [u8; 32] {
        secret.to_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_x25519_encryption_decryption() {
        let message = b"Hello, this is a secret message!";

        // Generate recipient's keypair
        let (recipient_secret, recipient_public) = DMCrypto::generate_x25519_keypair();

        // Generate ephemeral keypair for sender
        let (ephemeral_secret, ephemeral_public) = DMCrypto::generate_ephemeral_keypair();

        // Encrypt message
        let (encrypted, nonce) =
            DMCrypto::encrypt_message(message, ephemeral_secret, &recipient_public).unwrap();

        // Decrypt message
        let decrypted =
            DMCrypto::decrypt_message(&encrypted, &nonce, &recipient_secret, &ephemeral_public)
                .unwrap();

        assert_eq!(message, decrypted.as_slice());
    }

    #[test]
    fn test_ed25519_signing_verification() {
        let message = b"This message needs to be signed";

        // Generate a signing key
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        // Sign the message
        let signature = DMCrypto::sign_data(&signing_key, message);

        // Verify the signature
        assert!(DMCrypto::verify_signature(&verifying_key, message, &signature).is_ok());

        // Verify with wrong message should fail
        assert!(DMCrypto::verify_signature(&verifying_key, b"wrong message", &signature).is_err());
    }

    #[test]
    fn test_key_conversions() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let key_bytes = signing_key.to_bytes();

        let recovered_key = DMCrypto::signing_key_from_bytes(&key_bytes).unwrap();
        assert_eq!(signing_key.to_bytes(), recovered_key.to_bytes());

        let verifying_key = signing_key.verifying_key();
        let pub_bytes = verifying_key.to_bytes();

        let recovered_pub = DMCrypto::verifying_key_from_bytes(&pub_bytes).unwrap();
        assert_eq!(verifying_key.to_bytes(), recovered_pub.to_bytes());

        // Test X25519 key conversions
        let (x25519_secret, x25519_public) = DMCrypto::generate_x25519_keypair();
        let secret_bytes = DMCrypto::x25519_secret_to_bytes(&x25519_secret);
        let public_bytes = x25519_public.to_bytes();

        let recovered_secret = DMCrypto::x25519_secret_from_bytes(&secret_bytes).unwrap();
        let recovered_public = DMCrypto::x25519_public_from_bytes(&public_bytes).unwrap();

        assert_eq!(
            secret_bytes,
            DMCrypto::x25519_secret_to_bytes(&recovered_secret)
        );
        assert_eq!(x25519_public.to_bytes(), recovered_public.to_bytes());
    }
}
