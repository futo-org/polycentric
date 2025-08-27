use warp::test::request;
use warp::Filter;
use serde_json;

mod common;
use common::{TestSetup, TestIdentity, AuthHelper, MessageHelper};

use dm_server::handlers::{auth, keys, dm, AppState};
use dm_server::models::*;

fn create_test_routes(app_state: AppState) -> impl Filter<Extract = impl warp::Reply> + Clone {
    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type", "authorization"])
        .allow_methods(&[warp::http::Method::GET, warp::http::Method::POST]);

    let app_state_clone = app_state.clone();
    let with_state = warp::any().map(move || app_state_clone.clone());

    // Challenge endpoint
    let challenge = warp::path("challenge")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state.clone())
        .and_then(auth::get_challenge);

    // Register key endpoint
    let register_key = warp::path("register_key")
        .and(warp::path::end())
        .and(warp::post())
        .and(auth::with_auth(app_state.clone()))
        .and(warp::body::json())
        .and(with_state.clone())
        .and_then(keys::register_x25519_key);

    // Get key endpoint
    let get_key = warp::path("get_key")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state.clone())
        .and_then(keys::get_x25519_key);

    // Send DM endpoint
    let send_dm = warp::path("send")
        .and(warp::path::end())
        .and(warp::post())
        .and(auth::with_auth(app_state.clone()))
        .and(warp::body::json())
        .and(with_state.clone())
        .and_then(dm::send_dm);

    // Get history endpoint
    let get_history = warp::path("history")
        .and(warp::path::end())
        .and(warp::post())
        .and(auth::with_auth(app_state.clone()))
        .and(warp::body::json())
        .and(with_state.clone())
        .and_then(dm::get_dm_history);

    // Get conversations endpoint
    let get_conversations = warp::path("conversations")
        .and(warp::path::end())
        .and(warp::get())
        .and(auth::with_auth(app_state.clone()))
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(with_state.clone())
        .and_then(|identity, query: std::collections::HashMap<String, String>, state| {
            let limit = query.get("limit").and_then(|s| s.parse().ok());
            keys::get_conversations(identity, limit, state)
        });

    challenge
        .or(register_key)
        .or(get_key)
        .or(send_dm)
        .or(get_history)
        .or(get_conversations)
        .with(cors)
        .recover(auth::handle_auth_error)
}

#[tokio::test]
async fn test_register_x25519_key_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let signature = identity.sign_x25519_key();
    let auth_header = AuthHelper::create_auth_header(&identity, &setup.config.challenge_key).await;

    let routes = create_test_routes(setup.app_state.clone());

    let request_body = RegisterX25519KeyRequest {
        x25519_public_key: identity.x25519_public_key.clone(),
        signature,
    };

    let response = request()
        .method("POST")
        .path("/register_key")
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 200);

    let body: RegisterX25519KeyResponse = serde_json::from_slice(response.body()).unwrap();
    assert!(body.success);
    assert!(body.error.is_none());

    // Verify key was stored
    let stored_key = setup.db.get_x25519_key(&identity.polycentric_identity).await.unwrap();
    assert!(stored_key.is_some());
    assert_eq!(stored_key.unwrap().x25519_public_key, identity.x25519_public_key);
}

#[tokio::test]
async fn test_register_key_invalid_signature() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let wrong_signature = vec![0u8; 64]; // Wrong signature
    let auth_header = AuthHelper::create_auth_header(&identity, &setup.config.challenge_key).await;

    let routes = create_test_routes(setup.app_state.clone());

    let request_body = RegisterX25519KeyRequest {
        x25519_public_key: identity.x25519_public_key.clone(),
        signature: wrong_signature,
    };

    let response = request()
        .method("POST")
        .path("/register_key")
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 401); // Should be unauthorized due to invalid signature
}

#[tokio::test]
async fn test_get_x25519_key_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let signature = identity.sign_x25519_key();

    // First register the key
    setup.db.register_x25519_key(
        &identity.polycentric_identity,
        &identity.x25519_public_key,
        &signature,
    ).await.unwrap();

    let routes = create_test_routes(setup.app_state.clone());

    let request_body = GetX25519KeyRequest {
        identity: identity.polycentric_identity.clone(),
    };

    let response = request()
        .method("POST")
        .path("/get_key")
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 200);

    let body: GetX25519KeyResponse = serde_json::from_slice(response.body()).unwrap();
    assert!(body.found);
    assert_eq!(body.x25519_public_key.unwrap(), identity.x25519_public_key);
    assert!(body.timestamp.is_some());
}

#[tokio::test]
async fn test_get_nonexistent_key_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let routes = create_test_routes(setup.app_state.clone());

    let request_body = GetX25519KeyRequest {
        identity: identity.polycentric_identity.clone(),
    };

    let response = request()
        .method("POST")
        .path("/get_key")
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 200);

    let body: GetX25519KeyResponse = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.found);
    assert!(body.x25519_public_key.is_none());
    assert!(body.timestamp.is_none());
}

#[tokio::test]
async fn test_send_dm_api() {
    // Initialize logger to see auth errors
    let _ = env_logger::builder().is_test(true).try_init();
    
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register both users' keys
    let sender_signature = sender.sign_x25519_key();
    let recipient_signature = recipient.sign_x25519_key();

    setup.db.register_x25519_key(
        &sender.polycentric_identity,
        &sender.x25519_public_key,
        &sender_signature,
    ).await.unwrap();

    setup.db.register_x25519_key(
        &recipient.polycentric_identity,
        &recipient.x25519_public_key,
        &recipient_signature,
    ).await.unwrap();

    let auth_header = AuthHelper::create_auth_header(&sender, &setup.config.challenge_key).await;
    let routes = create_test_routes(setup.app_state.clone());

    let (message_id, ephemeral_public_key, encrypted_content, nonce, signature) = 
        MessageHelper::create_test_message(&sender, &recipient, "Hello, this is a test message!");

    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key,
        encrypted_content,
        nonce,
        message_id: message_id.clone(),
        reply_to: None,
        signature,
    };

    let response = request()
        .method("POST")
        .path("/send")
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    if response.status() != 200 {
        println!("Response status: {}", response.status());
        println!("Response body: {}", String::from_utf8_lossy(response.body()));
    }
    assert_eq!(response.status(), 200);

    let body: SendDMResponse = serde_json::from_slice(response.body()).unwrap();
    assert!(body.success);
    assert!(body.error.is_none());
    assert_eq!(body.message_id.unwrap(), message_id);

    // Verify message was stored
    let exists = setup.db.message_exists(&message_id).await.unwrap();
    assert!(exists);
}

#[tokio::test]
async fn test_send_dm_to_unregistered_user() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new(); // Not registered

    // Only register sender's key
    let sender_signature = sender.sign_x25519_key();
    setup.db.register_x25519_key(
        &sender.polycentric_identity,
        &sender.x25519_public_key,
        &sender_signature,
    ).await.unwrap();

    let auth_header = AuthHelper::create_auth_header(&sender, &setup.config.challenge_key).await;
    let routes = create_test_routes(setup.app_state.clone());

    let (message_id, ephemeral_public_key, encrypted_content, nonce, signature) = 
        MessageHelper::create_test_message(&sender, &recipient, "Hello!");

    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key,
        encrypted_content,
        nonce,
        message_id,
        reply_to: None,
        signature,
    };

    let response = request()
        .method("POST")
        .path("/send")
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 200);

    let body: SendDMResponse = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success);
    assert!(body.error.is_some());
    assert!(body.error.unwrap().contains("not registered for DMs"));
}

#[tokio::test]
async fn test_get_dm_history_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let user1 = TestIdentity::new();
    let user2 = TestIdentity::new();

    // Register both users
    let sig1 = user1.sign_x25519_key();
    let sig2 = user2.sign_x25519_key();
    setup.db.register_x25519_key(&user1.polycentric_identity, &user1.x25519_public_key, &sig1).await.unwrap();
    setup.db.register_x25519_key(&user2.polycentric_identity, &user2.x25519_public_key, &sig2).await.unwrap();

    // Store some messages
    let (msg_id1, eph_key1, enc_content1, nonce1, _) = MessageHelper::create_test_message(&user1, &user2, "Message 1");
    let (msg_id2, eph_key2, enc_content2, nonce2, _) = MessageHelper::create_test_message(&user2, &user1, "Message 2");

    setup.db.store_message(&msg_id1, &user1.polycentric_identity, &user2.polycentric_identity, 
        &eph_key1, &enc_content1, &nonce1, chrono::Utc::now() - chrono::Duration::seconds(2), None).await.unwrap();
    setup.db.store_message(&msg_id2, &user2.polycentric_identity, &user1.polycentric_identity, 
        &eph_key2, &enc_content2, &nonce2, chrono::Utc::now() - chrono::Duration::seconds(1), None).await.unwrap();

    let auth_header = AuthHelper::create_auth_header(&user1, &setup.config.challenge_key).await;
    let routes = create_test_routes(setup.app_state.clone());

    let request_body = GetDMHistoryRequest {
        other_party: user2.polycentric_identity.clone(),
        cursor: None,
        limit: Some(10),
    };

    let response = request()
        .method("POST")
        .path("/history")
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 200);

    let body: GetDMHistoryResponse = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(body.messages.len(), 2);
    assert!(!body.has_more);
    assert!(body.next_cursor.is_none());
}

#[tokio::test]
async fn test_send_dm_duplicate_message_id() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register both users
    let sender_signature = sender.sign_x25519_key();
    let recipient_signature = recipient.sign_x25519_key();
    setup.db.register_x25519_key(&sender.polycentric_identity, &sender.x25519_public_key, &sender_signature).await.unwrap();
    setup.db.register_x25519_key(&recipient.polycentric_identity, &recipient.x25519_public_key, &recipient_signature).await.unwrap();

    let auth_header = AuthHelper::create_auth_header(&sender, &setup.config.challenge_key).await;
    let routes = create_test_routes(setup.app_state.clone());

    let (message_id, ephemeral_public_key, encrypted_content, nonce, signature) = 
        MessageHelper::create_test_message(&sender, &recipient, "Test message");

    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key: ephemeral_public_key.clone(),
        encrypted_content: encrypted_content.clone(),
        nonce: nonce.clone(),
        message_id: message_id.clone(),
        reply_to: None,
        signature: signature.clone(),
    };

    // Send first message
    let response1 = request()
        .method("POST")
        .path("/send")
        .header("authorization", &auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response1.status(), 200);

    // Try to send same message again
    let response2 = request()
        .method("POST")
        .path("/send")
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response2.status(), 200);

    let body: SendDMResponse = serde_json::from_slice(response2.body()).unwrap();
    assert!(!body.success);
    assert!(body.error.is_some());
    assert!(body.error.unwrap().contains("already exists"));
}

#[tokio::test]
async fn test_send_dm_invalid_sizes() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register both users
    let sender_signature = sender.sign_x25519_key();
    let recipient_signature = recipient.sign_x25519_key();
    setup.db.register_x25519_key(&sender.polycentric_identity, &sender.x25519_public_key, &sender_signature).await.unwrap();
    setup.db.register_x25519_key(&recipient.polycentric_identity, &recipient.x25519_public_key, &recipient_signature).await.unwrap();

    let auth_header = AuthHelper::create_auth_header(&sender, &setup.config.challenge_key).await;
    let routes = create_test_routes(setup.app_state.clone());

    // Test invalid ephemeral key length
    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key: vec![0u8; 16], // Wrong length
        encrypted_content: vec![1u8; 100],
        nonce: vec![2u8; 24],
        message_id: "test_msg".to_string(),
        reply_to: None,
        signature: vec![3u8; 64],
    };

    let response = request()
        .method("POST")
        .path("/send")
        .header("authorization", &auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 200);
    let body: SendDMResponse = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success);
    assert!(body.error.unwrap().contains("ephemeral key length"));

    // Test invalid nonce length
    let request_body = SendDMRequest {
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key: vec![0u8; 32],
        encrypted_content: vec![1u8; 100],
        nonce: vec![2u8; 16], // Wrong length
        message_id: "test_msg2".to_string(),
        reply_to: None,
        signature: vec![3u8; 64],
    };

    let response = request()
        .method("POST")
        .path("/send")
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 200);
    let body: SendDMResponse = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success);
    assert!(body.error.unwrap().contains("nonce length"));
}

#[tokio::test]
async fn test_unauthorized_requests() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let routes = create_test_routes(setup.app_state.clone());

    // Test unauthorized register key
    let request_body = RegisterX25519KeyRequest {
        x25519_public_key: vec![0u8; 32],
        signature: vec![1u8; 64],
    };

    let response = request()
        .method("POST")
        .path("/register_key")
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 400); // No auth header

    // Test with invalid auth header
    let response = request()
        .method("POST")
        .path("/register_key")
        .header("authorization", "Bearer invalid")
        .header("content-type", "application/json")
        .json(&request_body)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 401); // Invalid auth
}

#[tokio::test]
async fn test_get_conversations_api() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let user1 = TestIdentity::new();
    let user2 = TestIdentity::new();
    let user3 = TestIdentity::new();

    // Store some messages to create conversations
    let (msg_id1, eph_key1, enc_content1, nonce1, _) = MessageHelper::create_test_message(&user1, &user2, "Message 1");
    let (msg_id2, eph_key2, enc_content2, nonce2, _) = MessageHelper::create_test_message(&user1, &user3, "Message 2");

    // Ensure proper timestamps: user3 gets older timestamp, user2 gets newer timestamp
    let now = chrono::Utc::now();
    let one_hour_ago = now - chrono::Duration::hours(1);

    setup.db.store_message(&msg_id2, &user1.polycentric_identity, &user3.polycentric_identity, 
        &eph_key2, &enc_content2, &nonce2, one_hour_ago, None).await.unwrap();
    setup.db.store_message(&msg_id1, &user1.polycentric_identity, &user2.polycentric_identity, 
        &eph_key1, &enc_content1, &nonce1, now, None).await.unwrap();

    let auth_header = AuthHelper::create_auth_header(&user1, &setup.config.challenge_key).await;
    let routes = create_test_routes(setup.app_state.clone());

    let response = request()
        .method("GET")
        .path("/conversations?limit=10")
        .header("authorization", auth_header)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), 200);

    let body: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    let conversations = body.as_array().unwrap();
    assert_eq!(conversations.len(), 2);



    // Should be ordered by most recent
    let first_identity = &conversations[0]["identity"];
    assert_eq!(first_identity["key_bytes"], serde_json::Value::Array(
        user2.polycentric_identity.key_bytes.iter().map(|&b| serde_json::Value::from(b)).collect()
    ));
}
