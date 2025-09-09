use axum::http::StatusCode;
use serde_json;
use serial_test::serial;

mod common;
use common::{AuthHelper, AxumTestHelper, MessageHelper, TestIdentity, TestSetup};

use dm_server::models::*;

#[tokio::test]
#[serial]
async fn test_register_x25519_key_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let signature = identity.sign_x25519_key();
    let auth_header = AuthHelper::create_auth_header(&identity, &setup.config.challenge_key).await;

    let router = setup.create_test_router();

    let request_body = RegisterX25519KeyRequest {
        x25519_public_key: identity.x25519_public_key.clone(),
        signature,
    };

    let (status, body) = AxumTestHelper::post(
        &router,
        "/register_key",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&auth_header),
    )
    .await;

    assert_eq!(status, StatusCode::OK);

    let response: RegisterX25519KeyResponse = serde_json::from_str(&body).unwrap();
    assert!(response.success);
    assert!(response.error.is_none());

    // Verify key was stored
    let stored_key = setup
        .db
        .get_x25519_key(&identity.polycentric_identity)
        .await
        .unwrap();
    assert!(stored_key.is_some());
    assert_eq!(
        stored_key.unwrap().x25519_public_key,
        identity.x25519_public_key
    );
}

#[tokio::test]
#[serial]
async fn test_register_key_invalid_signature() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let wrong_signature = vec![0u8; 64]; // Wrong signature
    let auth_header = AuthHelper::create_auth_header(&identity, &setup.config.challenge_key).await;

    let router = setup.create_test_router();

    let request_body = RegisterX25519KeyRequest {
        x25519_public_key: identity.x25519_public_key.clone(),
        signature: wrong_signature,
    };

    let (status, _body) = AxumTestHelper::post(
        &router,
        "/register_key",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&auth_header),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED); // Should be unauthorized due to invalid signature
}

#[tokio::test]
#[serial]
async fn test_get_x25519_key_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let signature = identity.sign_x25519_key();

    // First register the key
    setup
        .db
        .register_x25519_key(
            &identity.polycentric_identity,
            &identity.x25519_public_key,
            &signature,
        )
        .await
        .unwrap();

    let router = setup.create_test_router();

    let request_body = GetX25519KeyRequest {
        identity: identity.polycentric_identity.clone(),
    };

    let (status, body) = AxumTestHelper::post(
        &router,
        "/get_key",
        &serde_json::to_string(&request_body).unwrap(),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);

    let response: GetX25519KeyResponse = serde_json::from_str(&body).unwrap();
    assert!(response.found);
    assert_eq!(
        response.x25519_public_key.unwrap(),
        identity.x25519_public_key
    );
    assert!(response.timestamp.is_some());
}

#[tokio::test]
#[serial]
async fn test_get_nonexistent_key_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let router = setup.create_test_router();

    let request_body = GetX25519KeyRequest {
        identity: identity.polycentric_identity.clone(),
    };

    let (status, body) = AxumTestHelper::post(
        &router,
        "/get_key",
        &serde_json::to_string(&request_body).unwrap(),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);

    let response: GetX25519KeyResponse = serde_json::from_str(&body).unwrap();
    assert!(!response.found);
    assert!(response.x25519_public_key.is_none());
    assert!(response.timestamp.is_none());
}

#[tokio::test]
#[serial]
async fn test_send_dm_api() {
    // Initialize logger to see auth errors
    let _ = tracing_subscriber::fmt::try_init();

    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register both users' keys
    let sender_signature = sender.sign_x25519_key();
    let recipient_signature = recipient.sign_x25519_key();

    setup
        .db
        .register_x25519_key(
            &sender.polycentric_identity,
            &sender.x25519_public_key,
            &sender_signature,
        )
        .await
        .unwrap();

    setup
        .db
        .register_x25519_key(
            &recipient.polycentric_identity,
            &recipient.x25519_public_key,
            &recipient_signature,
        )
        .await
        .unwrap();

    let auth_header = AuthHelper::create_auth_header(&sender, &setup.config.challenge_key).await;
    let router = setup.create_test_router();

    let (message_id, ephemeral_public_key, encrypted_content, nonce, signature) =
        MessageHelper::create_test_message(&sender, &recipient, "Hello, this is a test message!");

    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key,
        encrypted_content,
        nonce,
        encryption_algorithm: Some("ChaCha20Poly1305".to_string()),
        message_id: message_id.clone(),
        reply_to: None,
        signature,
    };

    let (status, body) = AxumTestHelper::post(
        &router,
        "/send",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&auth_header),
    )
    .await;

    if status != StatusCode::OK {
        println!("Response status: {:?}", status);
        println!("Response body: {}", body);
    }
    assert_eq!(status, StatusCode::OK);

    let response: SendDMResponse = serde_json::from_str(&body).unwrap();
    assert!(response.success);
    assert!(response.error.is_none());
    assert_eq!(response.message_id.unwrap(), message_id);

    // Verify message was stored
    let exists = setup.db.message_exists(&message_id).await.unwrap();
    assert!(exists);
}

#[tokio::test]
#[serial]
async fn test_send_dm_to_unregistered_user() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new(); // Not registered

    // Only register sender's key
    let sender_signature = sender.sign_x25519_key();
    setup
        .db
        .register_x25519_key(
            &sender.polycentric_identity,
            &sender.x25519_public_key,
            &sender_signature,
        )
        .await
        .unwrap();

    let auth_header = AuthHelper::create_auth_header(&sender, &setup.config.challenge_key).await;
    let router = setup.create_test_router();

    let (message_id, ephemeral_public_key, encrypted_content, nonce, signature) =
        MessageHelper::create_test_message(&sender, &recipient, "Hello!");

    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key,
        encrypted_content,
        nonce,
        encryption_algorithm: Some("ChaCha20Poly1305".to_string()),
        message_id,
        reply_to: None,
        signature,
    };

    let (status, body) = AxumTestHelper::post(
        &router,
        "/send",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&auth_header),
    )
    .await;

    assert_eq!(status, StatusCode::OK);

    let response: SendDMResponse = serde_json::from_str(&body).unwrap();
    assert!(!response.success);
    assert!(response.error.is_some());
    assert!(response.error.unwrap().contains("not registered for DMs"));
}

#[tokio::test]
#[serial]
async fn test_get_dm_history_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let user1 = TestIdentity::new();
    let user2 = TestIdentity::new();

    // Register both users
    let sig1 = user1.sign_x25519_key();
    let sig2 = user2.sign_x25519_key();
    setup
        .db
        .register_x25519_key(&user1.polycentric_identity, &user1.x25519_public_key, &sig1)
        .await
        .unwrap();
    setup
        .db
        .register_x25519_key(&user2.polycentric_identity, &user2.x25519_public_key, &sig2)
        .await
        .unwrap();

    // Store some messages
    let (msg_id1, eph_key1, enc_content1, nonce1, _) =
        MessageHelper::create_test_message(&user1, &user2, "Message 1");
    let (msg_id2, eph_key2, enc_content2, nonce2, _) =
        MessageHelper::create_test_message(&user2, &user1, "Message 2");

    setup
        .db
        .store_message(
            &msg_id1,
            &user1.polycentric_identity,
            &user2.polycentric_identity,
            &eph_key1,
            &enc_content1,
            &nonce1,
            Some("ChaCha20Poly1305"),
            chrono::Utc::now() - chrono::Duration::seconds(2),
            None,
        )
        .await
        .unwrap();
    setup
        .db
        .store_message(
            &msg_id2,
            &user2.polycentric_identity,
            &user1.polycentric_identity,
            &eph_key2,
            &enc_content2,
            &nonce2,
            Some("ChaCha20Poly1305"),
            chrono::Utc::now() - chrono::Duration::seconds(1),
            None,
        )
        .await
        .unwrap();

    let auth_header = AuthHelper::create_auth_header(&user1, &setup.config.challenge_key).await;
    let router = setup.create_test_router();

    let request_body = GetDMHistoryRequest {
        other_party: user2.polycentric_identity.clone(),
        cursor: None,
        limit: Some(10),
    };

    let (status, body) = AxumTestHelper::post(
        &router,
        "/history",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&auth_header),
    )
    .await;

    assert_eq!(status, StatusCode::OK);

    let response: GetDMHistoryResponse = serde_json::from_str(&body).unwrap();
    assert_eq!(response.messages.len(), 2);
    assert!(!response.has_more);
    assert!(response.next_cursor.is_none());
}

#[tokio::test]
#[serial]
async fn test_send_dm_duplicate_message_id() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register both users
    let sender_signature = sender.sign_x25519_key();
    let recipient_signature = recipient.sign_x25519_key();
    setup
        .db
        .register_x25519_key(
            &sender.polycentric_identity,
            &sender.x25519_public_key,
            &sender_signature,
        )
        .await
        .unwrap();
    setup
        .db
        .register_x25519_key(
            &recipient.polycentric_identity,
            &recipient.x25519_public_key,
            &recipient_signature,
        )
        .await
        .unwrap();

    let auth_header = AuthHelper::create_auth_header(&sender, &setup.config.challenge_key).await;
    let router = setup.create_test_router();

    let (message_id, ephemeral_public_key, encrypted_content, nonce, signature) =
        MessageHelper::create_test_message(&sender, &recipient, "Test message");

    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key: ephemeral_public_key.clone(),
        encrypted_content: encrypted_content.clone(),
        nonce: nonce.clone(),
        encryption_algorithm: Some("ChaCha20Poly1305".to_string()),
        message_id: message_id.clone(),
        reply_to: None,
        signature: signature.clone(),
    };

    // Send first message
    let (status1, _body1) = AxumTestHelper::post(
        &router,
        "/send",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&auth_header),
    )
    .await;

    assert_eq!(status1, StatusCode::OK);

    // Try to send same message again
    let (status2, body2) = AxumTestHelper::post(
        &router,
        "/send",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&auth_header),
    )
    .await;

    assert_eq!(status2, StatusCode::OK);

    let response: SendDMResponse = serde_json::from_str(&body2).unwrap();
    assert!(!response.success);
    assert!(response.error.is_some());
    assert!(response.error.unwrap().contains("already exists"));
}

#[tokio::test]
#[serial]
async fn test_send_dm_invalid_sizes() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register both users
    let sender_signature = sender.sign_x25519_key();
    let recipient_signature = recipient.sign_x25519_key();
    setup
        .db
        .register_x25519_key(
            &sender.polycentric_identity,
            &sender.x25519_public_key,
            &sender_signature,
        )
        .await
        .unwrap();
    setup
        .db
        .register_x25519_key(
            &recipient.polycentric_identity,
            &recipient.x25519_public_key,
            &recipient_signature,
        )
        .await
        .unwrap();

    let auth_header = AuthHelper::create_auth_header(&sender, &setup.config.challenge_key).await;
    let router = setup.create_test_router();

    // Test invalid ephemeral key length
    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key: vec![0u8; 16], // Wrong length
        encrypted_content: vec![1u8; 100],
        nonce: vec![2u8; 24],
        encryption_algorithm: Some("ChaCha20Poly1305".to_string()),
        message_id: "test_msg".to_string(),
        reply_to: None,
        signature: vec![3u8; 64],
    };

    let (status, body) = AxumTestHelper::post(
        &router,
        "/send",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&&auth_header),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let response: SendDMResponse = serde_json::from_str(&body).unwrap();
    assert!(!response.success);
    assert!(response.error.unwrap().contains("ephemeral key length"));

    // Test invalid nonce length
    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key: vec![0u8; 32],
        encrypted_content: vec![1u8; 100],
        nonce: vec![2u8; 16], // Wrong length
        encryption_algorithm: Some("ChaCha20Poly1305".to_string()),
        message_id: "test_msg2".to_string(),
        reply_to: None,
        signature: vec![3u8; 64],
    };

    let (status, body) = AxumTestHelper::post(
        &router,
        "/send",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&auth_header),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let response: SendDMResponse = serde_json::from_str(&body).unwrap();
    assert!(!response.success);
    assert!(response.error.unwrap().contains("nonce length"));
}

#[tokio::test]
#[serial]
async fn test_unauthorized_requests() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let router = setup.create_test_router();

    // Test unauthorized register key
    let request_body = RegisterX25519KeyRequest {
        x25519_public_key: vec![0u8; 32],
        signature: vec![1u8; 64],
    };

    let (status, _body) = AxumTestHelper::post(
        &router,
        "/register_key",
        &serde_json::to_string(&request_body).unwrap(),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED); // No auth header

    // Test with invalid auth header
    let (status, _body) = AxumTestHelper::post(
        &router,
        "/register_key",
        &serde_json::to_string(&request_body).unwrap(),
        Some(&"Bearer invalid"),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED); // Invalid auth
}

#[tokio::test]
#[serial]
async fn test_get_conversations_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let user1 = TestIdentity::new();
    let user2 = TestIdentity::new();
    let user3 = TestIdentity::new();

    // Store some messages to create conversations
    let (msg_id1, eph_key1, enc_content1, nonce1, _) =
        MessageHelper::create_test_message(&user1, &user2, "Message 1");
    let (msg_id2, eph_key2, enc_content2, nonce2, _) =
        MessageHelper::create_test_message(&user1, &user3, "Message 2");

    // Ensure proper timestamps: user3 gets older timestamp, user2 gets newer timestamp
    let now = chrono::Utc::now();
    let one_hour_ago = now - chrono::Duration::hours(1);

    setup
        .db
        .store_message(
            &msg_id2,
            &user1.polycentric_identity,
            &user3.polycentric_identity,
            &eph_key2,
            &enc_content2,
            &nonce2,
            Some("ChaCha20Poly1305"),
            one_hour_ago,
            None,
        )
        .await
        .unwrap();
    setup
        .db
        .store_message(
            &msg_id1,
            &user1.polycentric_identity,
            &user2.polycentric_identity,
            &eph_key1,
            &enc_content1,
            &nonce1,
            Some("ChaCha20Poly1305"),
            now,
            None,
        )
        .await
        .unwrap();

    let auth_header = AuthHelper::create_auth_header(&user1, &setup.config.challenge_key).await;
    let router = setup.create_test_router();

    let (status, body) =
        AxumTestHelper::get(&router, "/conversations?limit=10", Some(&auth_header)).await;

    assert_eq!(status, StatusCode::OK);

    let body: serde_json::Value = serde_json::from_str(&body).unwrap();
    let conversations = body.as_array().unwrap();
    assert_eq!(conversations.len(), 2);

    // Should be ordered by most recent
    let first_identity = &conversations[0]["identity"];
    assert_eq!(
        first_identity["key_bytes"],
        serde_json::Value::Array(
            user2
                .polycentric_identity
                .key_bytes
                .iter()
                .map(|&b| serde_json::Value::from(b))
                .collect()
        )
    );
}
