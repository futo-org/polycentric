use serial_test::serial;

mod common;
use common::{MessageHelper, TestIdentity, TestSetup};

use dm_server::{
    models::{DMMessageResponse, WSMessage},
    websocket::WebSocketManager,
};

/// Integration tests that test the full flow from message sending to WebSocket delivery
#[tokio::test]
#[serial]
async fn test_full_message_flow() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register both users' X25519 keys
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

    // Create and store a message
    let (message_id, ephemeral_key, encrypted_content, nonce, _signature) =
        MessageHelper::create_test_message(&sender, &recipient, "Hello from integration test!");

    let message_timestamp = chrono::Utc::now();
    setup
        .db
        .store_message(
            &message_id,
            &sender.polycentric_identity,
            &recipient.polycentric_identity,
            &ephemeral_key,
            &encrypted_content,
            &nonce,
            Some("ChaCha20Poly1305"),
            message_timestamp,
            None,
        )
        .await
        .unwrap();

    // Verify message was stored
    let history = setup
        .db
        .get_dm_history(
            &sender.polycentric_identity,
            &recipient.polycentric_identity,
            None,
            10,
        )
        .await
        .unwrap();

    assert_eq!(history.len(), 1);
    assert_eq!(history[0].message_id, message_id);

    // Test decryption
    let decrypted =
        MessageHelper::decrypt_test_message(&recipient, &ephemeral_key, &encrypted_content, &nonce)
            .unwrap();

    assert_eq!(decrypted, "Hello from integration test!");
}

#[tokio::test]
#[serial]
async fn test_websocket_message_delivery() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let ws_manager = WebSocketManager::new();
    let recipient = TestIdentity::new();
    let sender = TestIdentity::new();

    // Register recipient's WebSocket connection
    let connection_id = uuid::Uuid::new_v4();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    ws_manager
        .register_connection(connection_id, recipient.polycentric_identity.clone(), tx)
        .await;

    // Create and send a DM message via WebSocket
    let dm_message = DMMessageResponse {
        message_id: "ws_test_msg".to_string(),
        sender: sender.polycentric_identity.clone(),
        recipient: recipient.polycentric_identity.clone(),
        ephemeral_public_key: vec![1u8; 32],
        encrypted_content: vec![2u8; 100],
        nonce: vec![3u8; 24],
        encryption_algorithm: "ChaCha20Poly1305".to_string(),
        timestamp: chrono::Utc::now(),
        reply_to: None,
    };

    let ws_message = WSMessage::DMMessage {
        message: dm_message.clone(),
    };

    ws_manager
        .send_to_user(&recipient.polycentric_identity, ws_message)
        .await;

    // Verify message was delivered
    let received = rx.recv().await;
    assert!(received.is_some());

    if let Some(tokio_tungstenite::tungstenite::Message::Text(text)) = received {
        let parsed: WSMessage = serde_json::from_str(&text).unwrap();
        match parsed {
            WSMessage::DMMessage { message } => {
                assert_eq!(message.message_id, dm_message.message_id);
                assert_eq!(
                    message.sender.key_bytes,
                    sender.polycentric_identity.key_bytes
                );
            }
            _ => panic!("Wrong message type received"),
        }
    }
}

#[tokio::test]
#[serial]
async fn test_user_registration_and_messaging_flow() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let alice = TestIdentity::new();
    let bob = TestIdentity::new();

    // Step 1: Both users register their X25519 keys
    let alice_signature = alice.sign_x25519_key();
    let bob_signature = bob.sign_x25519_key();

    setup
        .db
        .register_x25519_key(
            &alice.polycentric_identity,
            &alice.x25519_public_key,
            &alice_signature,
        )
        .await
        .unwrap();

    setup
        .db
        .register_x25519_key(
            &bob.polycentric_identity,
            &bob.x25519_public_key,
            &bob_signature,
        )
        .await
        .unwrap();

    // Step 2: Alice sends message to Bob
    let (msg1_id, eph_key1, enc_content1, nonce1, _) =
        MessageHelper::create_test_message(&alice, &bob, "Hi Bob!");

    setup
        .db
        .store_message(
            &msg1_id,
            &alice.polycentric_identity,
            &bob.polycentric_identity,
            &eph_key1,
            &enc_content1,
            &nonce1,
            Some("ChaCha20Poly1305"),
            chrono::Utc::now(),
            None,
        )
        .await
        .unwrap();

    // Step 3: Bob sends reply to Alice
    let (msg2_id, eph_key2, enc_content2, nonce2, _) =
        MessageHelper::create_test_message(&bob, &alice, "Hi Alice!");

    setup
        .db
        .store_message(
            &msg2_id,
            &bob.polycentric_identity,
            &alice.polycentric_identity,
            &eph_key2,
            &enc_content2,
            &nonce2,
            Some("ChaCha20Poly1305"),
            chrono::Utc::now() + chrono::Duration::seconds(1),
            Some(&msg1_id), // Reply to Alice's message
        )
        .await
        .unwrap();

    // Step 4: Verify conversation history
    let alice_history = setup
        .db
        .get_dm_history(
            &alice.polycentric_identity,
            &bob.polycentric_identity,
            None,
            10,
        )
        .await
        .unwrap();

    let bob_history = setup
        .db
        .get_dm_history(
            &bob.polycentric_identity,
            &alice.polycentric_identity,
            None,
            10,
        )
        .await
        .unwrap();

    // Both should see the same conversation
    assert_eq!(alice_history.len(), 2);
    assert_eq!(bob_history.len(), 2);

    assert_eq!(alice_history[0].reply_to_message_id, Some(msg1_id.clone()));

    // Step 5: Verify message decryption
    let decrypted1 =
        MessageHelper::decrypt_test_message(&bob, &eph_key1, &enc_content1, &nonce1).unwrap();
    assert_eq!(decrypted1, "Hi Bob!");

    let decrypted2 =
        MessageHelper::decrypt_test_message(&alice, &eph_key2, &enc_content2, &nonce2).unwrap();
    assert_eq!(decrypted2, "Hi Alice!");

    // Step 6: Test conversation list
    let conversations = setup
        .db
        .get_conversation_list(&alice.polycentric_identity, 10)
        .await
        .unwrap();
    assert_eq!(conversations.len(), 1);
    assert_eq!(
        conversations[0].0.key_bytes,
        bob.polycentric_identity.key_bytes
    );
}

#[tokio::test]
#[serial]
async fn test_message_delivery_tracking() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register users
    let sender_sig = sender.sign_x25519_key();
    let recipient_sig = recipient.sign_x25519_key();
    setup
        .db
        .register_x25519_key(
            &sender.polycentric_identity,
            &sender.x25519_public_key,
            &sender_sig,
        )
        .await
        .unwrap();
    setup
        .db
        .register_x25519_key(
            &recipient.polycentric_identity,
            &recipient.x25519_public_key,
            &recipient_sig,
        )
        .await
        .unwrap();

    // Send message
    let (message_id, eph_key, enc_content, nonce, _) =
        MessageHelper::create_test_message(&sender, &recipient, "Delivery test message");

    setup
        .db
        .store_message(
            &message_id,
            &sender.polycentric_identity,
            &recipient.polycentric_identity,
            &eph_key,
            &enc_content,
            &nonce,
            Some("ChaCha20Poly1305"),
            chrono::Utc::now(),
            None,
        )
        .await
        .unwrap();

    // Simulate message delivery
    let delivered_at = chrono::Utc::now();
    setup
        .db
        .mark_message_delivered(&message_id, delivered_at)
        .await
        .unwrap();

    // Simulate message read
    let read_at = chrono::Utc::now();
    setup
        .db
        .mark_message_read(&message_id, read_at)
        .await
        .unwrap();

    // Verify delivery status
    let history = setup
        .db
        .get_dm_history(
            &sender.polycentric_identity,
            &recipient.polycentric_identity,
            None,
            10,
        )
        .await
        .unwrap();

    assert_eq!(history.len(), 1);
    assert!(history[0].delivered_at.is_some());
    assert!(history[0].read_at.is_some());
}

#[tokio::test]
#[serial]
async fn test_undelivered_messages_retrieval() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Register users
    let sender_sig = sender.sign_x25519_key();
    let recipient_sig = recipient.sign_x25519_key();
    setup
        .db
        .register_x25519_key(
            &sender.polycentric_identity,
            &sender.x25519_public_key,
            &sender_sig,
        )
        .await
        .unwrap();
    setup
        .db
        .register_x25519_key(
            &recipient.polycentric_identity,
            &recipient.x25519_public_key,
            &recipient_sig,
        )
        .await
        .unwrap();

    let base_time = chrono::Utc::now();

    // Send multiple messages
    for i in 0..3 {
        let (message_id, eph_key, enc_content, nonce, _) =
            MessageHelper::create_test_message(&sender, &recipient, &format!("Message {}", i));

        setup
            .db
            .store_message(
                &message_id,
                &sender.polycentric_identity,
                &recipient.polycentric_identity,
                &eph_key,
                &enc_content,
                &nonce,
                Some("ChaCha20Poly1305"),
                base_time + chrono::Duration::seconds(i),
                None,
            )
            .await
            .unwrap();

        // Mark first message as delivered
        if i == 0 {
            setup
                .db
                .mark_message_delivered(&message_id, base_time + chrono::Duration::seconds(10))
                .await
                .unwrap();
        }
    }

    // Get undelivered messages
    let undelivered = setup
        .db
        .get_undelivered_messages(
            &recipient.polycentric_identity,
            base_time - chrono::Duration::hours(1),
        )
        .await
        .unwrap();

    assert_eq!(undelivered.len(), 2); // Two undelivered messages
}

#[tokio::test]
#[serial]
async fn test_multiple_device_connections() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let ws_manager = WebSocketManager::new();
    let user = TestIdentity::new();

    // Simulate multiple device connections
    let device1_id = uuid::Uuid::new_v4();
    let device2_id = uuid::Uuid::new_v4();
    let device3_id = uuid::Uuid::new_v4();

    let (tx1, mut rx1) = tokio::sync::mpsc::unbounded_channel();
    let (tx2, mut rx2) = tokio::sync::mpsc::unbounded_channel();
    let (tx3, mut rx3) = tokio::sync::mpsc::unbounded_channel();

    // Register connections
    ws_manager
        .register_connection(device1_id, user.polycentric_identity.clone(), tx1)
        .await;
    ws_manager
        .register_connection(device2_id, user.polycentric_identity.clone(), tx2)
        .await;
    ws_manager
        .register_connection(device3_id, user.polycentric_identity.clone(), tx3)
        .await;

    // Register in database
    setup
        .db
        .register_connection(device1_id, &user.polycentric_identity, Some("Mobile App"))
        .await
        .unwrap();
    setup
        .db
        .register_connection(device2_id, &user.polycentric_identity, Some("Desktop App"))
        .await
        .unwrap();
    setup
        .db
        .register_connection(device3_id, &user.polycentric_identity, Some("Web Browser"))
        .await
        .unwrap();

    // Verify connection count
    let count = ws_manager
        .get_user_connection_count(&user.polycentric_identity)
        .await;
    assert_eq!(count, 3);

    let db_connections = setup
        .db
        .get_user_connections(&user.polycentric_identity)
        .await
        .unwrap();
    assert_eq!(db_connections.len(), 3);

    // Send message to all devices
    let test_message = WSMessage::Ping;
    ws_manager
        .send_to_user(&user.polycentric_identity, test_message)
        .await;

    // All devices should receive the message
    let received1 = rx1.recv().await;
    let received2 = rx2.recv().await;
    let received3 = rx3.recv().await;

    assert!(received1.is_some());
    assert!(received2.is_some());
    assert!(received3.is_some());

    // Disconnect one device
    ws_manager.unregister_connection(device1_id).await;
    setup.db.remove_connection(device1_id).await.unwrap();

    let count = ws_manager
        .get_user_connection_count(&user.polycentric_identity)
        .await;
    assert_eq!(count, 2);

    let db_connections = setup
        .db
        .get_user_connections(&user.polycentric_identity)
        .await
        .unwrap();
    assert_eq!(db_connections.len(), 2);
}

#[tokio::test]
#[serial]
async fn test_connection_cleanup() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let user = TestIdentity::new();
    let connection_id = uuid::Uuid::new_v4();

    // Register connection
    setup
        .db
        .register_connection(connection_id, &user.polycentric_identity, None)
        .await
        .unwrap();

    // Manually set old ping time
    sqlx::query(
        "UPDATE active_connections SET last_ping = NOW() - INTERVAL '1 hour' WHERE connection_id = $1"
    )
    .bind(connection_id)
    .execute(&setup.pool)
    .await
    .unwrap();

    // Run cleanup (5 minute timeout)
    let cleaned = setup.db.cleanup_stale_connections(300).await.unwrap();
    assert_eq!(cleaned, 1);

    // Verify connection was removed
    let connections = setup
        .db
        .get_user_connections(&user.polycentric_identity)
        .await
        .unwrap();
    assert_eq!(connections.len(), 0);
}

#[tokio::test]
#[serial]
async fn test_message_pagination() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let alice = TestIdentity::new();
    let bob = TestIdentity::new();

    // Register users
    let alice_sig = alice.sign_x25519_key();
    let bob_sig = bob.sign_x25519_key();
    setup
        .db
        .register_x25519_key(
            &alice.polycentric_identity,
            &alice.x25519_public_key,
            &alice_sig,
        )
        .await
        .unwrap();
    setup
        .db
        .register_x25519_key(&bob.polycentric_identity, &bob.x25519_public_key, &bob_sig)
        .await
        .unwrap();

    let base_time = chrono::Utc::now();

    // Create 10 messages
    let mut message_ids = Vec::new();
    for i in 0..10 {
        let (message_id, eph_key, enc_content, nonce, _) =
            MessageHelper::create_test_message(&alice, &bob, &format!("Message {}", i));

        setup
            .db
            .store_message(
                &message_id,
                &alice.polycentric_identity,
                &bob.polycentric_identity,
                &eph_key,
                &enc_content,
                &nonce,
                Some("ChaCha20Poly1305"),
                base_time + chrono::Duration::seconds(i),
                None,
            )
            .await
            .unwrap();

        message_ids.push(message_id);
    }

    // Get first page (5 messages)
    let page1 = setup
        .db
        .get_dm_history(
            &alice.polycentric_identity,
            &bob.polycentric_identity,
            None,
            5,
        )
        .await
        .unwrap();

    assert_eq!(page1.len(), 5);

    // Get second page using cursor
    let cursor = page1.last().unwrap().created_at.to_rfc3339();
    let page2 = setup
        .db
        .get_dm_history(
            &alice.polycentric_identity,
            &bob.polycentric_identity,
            Some(&cursor),
            5,
        )
        .await
        .unwrap();

    assert_eq!(page2.len(), 5);

    // Verify no overlap between pages
    let page1_ids: std::collections::HashSet<_> = page1.iter().map(|m| &m.message_id).collect();
    let page2_ids: std::collections::HashSet<_> = page2.iter().map(|m| &m.message_id).collect();

    assert!(page1_ids.is_disjoint(&page2_ids));

    // Get third page (should be empty)
    let cursor = page2.last().unwrap().created_at.to_rfc3339();
    let page3 = setup
        .db
        .get_dm_history(
            &alice.polycentric_identity,
            &bob.polycentric_identity,
            Some(&cursor),
            5,
        )
        .await
        .unwrap();

    assert_eq!(page3.len(), 0);
}
