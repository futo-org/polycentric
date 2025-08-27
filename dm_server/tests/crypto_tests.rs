use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;

use dm_server::crypto::DMCrypto;

#[test]
fn test_x25519_key_generation() {
    let (secret, public) = DMCrypto::generate_x25519_keypair();
    
    // Keys should be 32 bytes
    assert_eq!(secret.to_bytes().len(), 32);
    assert_eq!(public.to_bytes().len(), 32);
    
    // Multiple generations should produce different keys
    let (secret2, public2) = DMCrypto::generate_x25519_keypair();
    assert_ne!(secret.to_bytes(), secret2.to_bytes());
    assert_ne!(public.to_bytes(), public2.to_bytes());
}

#[test]
fn test_ephemeral_key_generation() {
    let (secret, public) = DMCrypto::generate_ephemeral_keypair();
    
    // Keys should be 32 bytes
    assert_eq!(public.to_bytes().len(), 32);
    
    // Multiple generations should produce different keys
    let (secret2, public2) = DMCrypto::generate_ephemeral_keypair();
    assert_ne!(public.to_bytes(), public2.to_bytes());
}

#[test]
fn test_ed25519_signing_and_verification() {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    
    let message = b"Test message for signing";
    
    // Sign message
    let signature = DMCrypto::sign_data(&signing_key, message);
    assert_eq!(signature.len(), 64); // Ed25519 signature is 64 bytes
    
    // Verify signature
    let result = DMCrypto::verify_signature(&verifying_key, message, &signature);
    assert!(result.is_ok());
    
    // Verify with wrong message should fail
    let wrong_message = b"Wrong message";
    let result = DMCrypto::verify_signature(&verifying_key, wrong_message, &signature);
    assert!(result.is_err());
    
    // Verify with wrong signature should fail
    let wrong_signature = vec![0u8; 64];
    let result = DMCrypto::verify_signature(&verifying_key, message, &wrong_signature);
    assert!(result.is_err());
}

#[test]
fn test_message_encryption_decryption() {
    let message = b"This is a secret message that needs to be encrypted!";
    
    // Generate recipient's keypair
    let (recipient_secret, recipient_public) = DMCrypto::generate_x25519_keypair();
    
    // Generate ephemeral keypair for sender
    let (ephemeral_secret, ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
    
    // Encrypt message
    let (encrypted, nonce) = DMCrypto::encrypt_message(
        message,
        ephemeral_secret,
        &recipient_public,
    ).unwrap();
    
    // Verify encrypted data
    assert_ne!(encrypted, message); // Should be different from original
    assert_eq!(nonce.len(), 12); // ChaCha20Poly1305 nonce is 12 bytes
    assert!(encrypted.len() > message.len()); // Should include auth tag
    
    // Decrypt message
    let decrypted = DMCrypto::decrypt_message(
        &encrypted,
        &nonce,
        &recipient_secret,
        &ephemeral_public,
    ).unwrap();
    
    // Verify decryption
    assert_eq!(decrypted, message);
}

#[test]
fn test_encryption_with_different_keys_fails() {
    let message = b"Secret message";
    
    // Generate two different recipient keypairs
    let (recipient_secret1, recipient_public1) = DMCrypto::generate_x25519_keypair();
    let (recipient_secret2, _recipient_public2) = DMCrypto::generate_x25519_keypair();
    
    // Generate ephemeral keypair
    let (ephemeral_secret, ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
    
    // Encrypt for recipient 1
    let (encrypted, nonce) = DMCrypto::encrypt_message(
        message,
        ephemeral_secret,
        &recipient_public1,
    ).unwrap();
    
    // Try to decrypt with recipient 2's key (should fail)
    let result = DMCrypto::decrypt_message(
        &encrypted,
        &nonce,
        &recipient_secret2,
        &ephemeral_public,
    );
    
    assert!(result.is_err());
}

#[test]
fn test_encryption_with_wrong_nonce_fails() {
    let message = b"Secret message";
    
    let (recipient_secret, recipient_public) = DMCrypto::generate_x25519_keypair();
    let (ephemeral_secret, ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
    
    // Encrypt message
    let (encrypted, _nonce) = DMCrypto::encrypt_message(
        message,
        ephemeral_secret,
        &recipient_public,
    ).unwrap();
    
    // Try to decrypt with wrong nonce
    let wrong_nonce = vec![0u8; 12];
    let result = DMCrypto::decrypt_message(
        &encrypted,
        &wrong_nonce,
        &recipient_secret,
        &ephemeral_public,
    );
    
    assert!(result.is_err());
}

#[test]
fn test_challenge_generation() {
    let challenge1 = DMCrypto::generate_challenge();
    let challenge2 = DMCrypto::generate_challenge();
    
    // Challenges should be 32 bytes
    assert_eq!(challenge1.len(), 32);
    assert_eq!(challenge2.len(), 32);
    
    // Should be different
    assert_ne!(challenge1, challenge2);
}

#[test]
fn test_key_conversions() {
    // Test Ed25519 key conversions
    let signing_key = SigningKey::generate(&mut OsRng);
    let key_bytes = signing_key.to_bytes();
    
    let recovered_signing_key = DMCrypto::signing_key_from_bytes(&key_bytes).unwrap();
    assert_eq!(signing_key.to_bytes(), recovered_signing_key.to_bytes());
    
    let verifying_key = signing_key.verifying_key();
    let pub_bytes = verifying_key.to_bytes();
    
    let recovered_verifying_key = DMCrypto::verifying_key_from_bytes(&pub_bytes).unwrap();
    assert_eq!(verifying_key.to_bytes(), recovered_verifying_key.to_bytes());
    
    // Test X25519 key conversions
    let (x25519_secret, x25519_public) = DMCrypto::generate_x25519_keypair();
    let secret_bytes = x25519_secret.to_bytes();
    let public_bytes = x25519_public.to_bytes();
    
    let recovered_secret = DMCrypto::x25519_secret_from_bytes(&secret_bytes).unwrap();
    let recovered_public = DMCrypto::x25519_public_from_bytes(&public_bytes).unwrap();
    
    assert_eq!(x25519_secret.to_bytes(), recovered_secret.to_bytes());
    assert_eq!(x25519_public.to_bytes(), recovered_public.to_bytes());
}

#[test]
fn test_invalid_key_lengths() {
    // Test Ed25519 with wrong key length
    let wrong_length_key = vec![0u8; 16]; // Should be 32 bytes
    
    let result = DMCrypto::signing_key_from_bytes(&wrong_length_key);
    assert!(result.is_err());
    
    let result = DMCrypto::verifying_key_from_bytes(&wrong_length_key);
    assert!(result.is_err());
    
    // Test X25519 with wrong key length
    let result = DMCrypto::x25519_secret_from_bytes(&wrong_length_key);
    assert!(result.is_err());
    
    let result = DMCrypto::x25519_public_from_bytes(&wrong_length_key);
    assert!(result.is_err());
}

#[test]
fn test_invalid_ed25519_public_key() {
    // Create invalid public key (invalid length)
    let invalid_key = vec![0u8; 31]; // Wrong length
    
    let result = DMCrypto::verifying_key_from_bytes(&invalid_key);
    assert!(result.is_err());
}

#[test]
fn test_cross_key_encryption() {
    // Test that two different sender-recipient pairs produce different ciphertexts
    let message = b"Same message";
    
    let (alice_secret, alice_public) = DMCrypto::generate_x25519_keypair();
    let (bob_secret, bob_public) = DMCrypto::generate_x25519_keypair();
    
    // Alice encrypts for Bob
    let (alice_ephemeral_secret, alice_ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
    let (encrypted1, nonce1) = DMCrypto::encrypt_message(
        message,
        alice_ephemeral_secret,
        &bob_public,
    ).unwrap();
    
    // Bob encrypts for Alice (same message)
    let (bob_ephemeral_secret, bob_ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
    let (encrypted2, nonce2) = DMCrypto::encrypt_message(
        message,
        bob_ephemeral_secret,
        &alice_public,
    ).unwrap();
    
    // Ciphertexts should be different
    assert_ne!(encrypted1, encrypted2);
    assert_ne!(nonce1, nonce2);
    
    // Bob can decrypt Alice's message
    let decrypted1 = DMCrypto::decrypt_message(
        &encrypted1,
        &nonce1,
        &bob_secret,
        &alice_ephemeral_public,
    ).unwrap();
    
    // Alice can decrypt Bob's message
    let decrypted2 = DMCrypto::decrypt_message(
        &encrypted2,
        &nonce2,
        &alice_secret,
        &bob_ephemeral_public,
    ).unwrap();
    
    // Both should decrypt to the original message
    assert_eq!(decrypted1, message);
    assert_eq!(decrypted2, message);
}

// Integration tests (moved from crypto_integration_test.rs)

/// This test proves that our end-to-end encryption actually works
#[test]
fn test_complete_message_encryption_flow() {
    // Alice and Bob generate their key pairs
    let (alice_secret, alice_public) = DMCrypto::generate_x25519_keypair();
    let (bob_secret, bob_public) = DMCrypto::generate_x25519_keypair();
    
    let original_message = "Hello Bob! This is a secret message from Alice.";
    
    // Alice sends a message to Bob
    // 1. Alice generates ephemeral key for this message
    let (ephemeral_secret, ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
    
    // 2. Alice encrypts the message using Bob's public key
    let (encrypted_data, nonce) = DMCrypto::encrypt_message(
        original_message.as_bytes(),
        ephemeral_secret,
        &bob_public,
    ).unwrap();
    
    // 3. Alice sends: encrypted_data, nonce, ephemeral_public
    // (In real system, this would go through the server)
    
    // 4. Bob receives and decrypts the message
    let decrypted_data = DMCrypto::decrypt_message(
        &encrypted_data,
        &nonce,
        &bob_secret,
        &ephemeral_public,
    ).unwrap();
    
    let decrypted_message = String::from_utf8(decrypted_data).unwrap();
    
    // 5. Verify the message is correct
    assert_eq!(original_message, decrypted_message);
    println!("✅ SUCCESS: Message encrypted and decrypted correctly!");
    println!("Original:  '{}'", original_message);
    println!("Decrypted: '{}'", decrypted_message);
}

/// Test that different key pairs can't decrypt each other's messages
#[test]
fn test_encryption_security() {
    let (alice_secret, alice_public) = DMCrypto::generate_x25519_keypair();
    let (bob_secret, bob_public) = DMCrypto::generate_x25519_keypair();
    let (eve_secret, _eve_public) = DMCrypto::generate_x25519_keypair(); // Eavesdropper
    
    let secret_message = "This is for Bob only!";
    
    // Alice encrypts for Bob
    let (ephemeral_secret, ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
    let (encrypted_data, nonce) = DMCrypto::encrypt_message(
        secret_message.as_bytes(),
        ephemeral_secret,
        &bob_public,
    ).unwrap();
    
    // Bob can decrypt
    let bob_result = DMCrypto::decrypt_message(
        &encrypted_data,
        &nonce,
        &bob_secret,
        &ephemeral_public,
    );
    assert!(bob_result.is_ok());
    
    // Eve cannot decrypt (should fail)
    let eve_result = DMCrypto::decrypt_message(
        &encrypted_data,
        &nonce,
        &eve_secret,
        &ephemeral_public,
    );
    assert!(eve_result.is_err());
    
    println!("✅ SUCCESS: Encryption is secure - only intended recipient can decrypt!");
}

/// Test key serialization and persistence (for database storage)
#[test]
fn test_key_persistence() {
    // Generate a key pair
    let (original_secret, original_public) = DMCrypto::generate_x25519_keypair();
    
    // Convert to bytes (for database storage)
    let secret_bytes = DMCrypto::x25519_secret_to_bytes(&original_secret);
    let public_bytes = original_public.to_bytes();
    
    // Store in "database" (simulate storage/retrieval)
    // ... database storage would happen here ...
    
    // Retrieve from "database" 
    let recovered_secret = DMCrypto::x25519_secret_from_bytes(&secret_bytes).unwrap();
    let recovered_public = DMCrypto::x25519_public_from_bytes(&public_bytes).unwrap();
    
    // Test that keys work after recovery
    let test_message = "Test persistence";
    let (ephemeral_secret, ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
    
    // Encrypt with recovered public key
    let (encrypted, nonce) = DMCrypto::encrypt_message(
        test_message.as_bytes(),
        ephemeral_secret,
        &recovered_public,
    ).unwrap();
    
    // Decrypt with recovered secret key
    let decrypted = DMCrypto::decrypt_message(
        &encrypted,
        &nonce,
        &recovered_secret,
        &ephemeral_public,
    ).unwrap();
    
    assert_eq!(test_message.as_bytes(), decrypted);
    println!("✅ SUCCESS: Keys can be stored and recovered from database!");
}
