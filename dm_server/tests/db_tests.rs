use chrono::Utc;
use uuid::Uuid;

mod common;
use common::{TestSetup, TestIdentity};

#[tokio::test]
async fn test_register_and_get_x25519_key() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let signature = identity.sign_x25519_key();

    // Register key
    let result = setup.db.register_x25519_key(
        &identity.polycentric_identity,
        &identity.x25519_public_key,
        &signature,
    ).await;
    assert!(result.is_ok());

    // Get key
    let retrieved = setup.db.get_x25519_key(&identity.polycentric_identity).await;
    assert!(retrieved.is_ok());

    let key_data = retrieved.unwrap();
    assert!(key_data.is_some());

    let key_data = key_data.unwrap();
    assert_eq!(key_data.x25519_public_key, identity.x25519_public_key);
    assert_eq!(key_data.signature, signature);
    assert_eq!(key_data.identity_key_type, identity.polycentric_identity.key_type as i64);
    assert_eq!(key_data.identity_key_bytes, identity.polycentric_identity.key_bytes);
}

#[tokio::test]
async fn test_update_x25519_key() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let signature1 = identity.sign_x25519_key();

    // Register initial key
    setup.db.register_x25519_key(
        &identity.polycentric_identity,
        &identity.x25519_public_key,
        &signature1,
    ).await.unwrap();

    // Generate new key
    let identity2 = TestIdentity::new();
    let new_x25519_key = identity2.x25519_public_key.clone();
    let signature2 = identity.sign_data(&new_x25519_key);

    // Update key
    setup.db.register_x25519_key(
        &identity.polycentric_identity,
        &new_x25519_key,
        &signature2,
    ).await.unwrap();

    // Verify update
    let retrieved = setup.db.get_x25519_key(&identity.polycentric_identity).await.unwrap().unwrap();
    assert_eq!(retrieved.x25519_public_key, new_x25519_key);
    assert_eq!(retrieved.signature, signature2);
}

#[tokio::test]
async fn test_get_nonexistent_key() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let result = setup.db.get_x25519_key(&identity.polycentric_identity).await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[tokio::test]
async fn test_store_and_retrieve_message() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    let message_id = "test_message_123";
    let ephemeral_key = vec![1u8; 32];
    let encrypted_content = vec![2u8; 100];
    let nonce = vec![3u8; 12];
    let timestamp = Utc::now();

    // Store message
    let result = setup.db.store_message(
        message_id,
        &sender.polycentric_identity,
        &recipient.polycentric_identity,
        &ephemeral_key,
        &encrypted_content,
        &nonce,
        timestamp,
        None,
    ).await;
    assert!(result.is_ok());

    // Get message history
    let messages = setup.db.get_dm_history(
        &sender.polycentric_identity,
        &recipient.polycentric_identity,
        None,
        10,
    ).await.unwrap();

    assert_eq!(messages.len(), 1);
    let message = &messages[0];
    assert_eq!(message.message_id, message_id);
    assert_eq!(message.ephemeral_public_key, ephemeral_key);
    assert_eq!(message.encrypted_content, encrypted_content);
    assert_eq!(message.nonce, nonce);
}

#[tokio::test]
async fn test_message_history_pagination() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    // Store multiple messages
    for i in 0..5 {
        let message_id = format!("test_message_{}", i);
        let timestamp = Utc::now() - chrono::Duration::seconds(i);
        
        setup.db.store_message(
            &message_id,
            &sender.polycentric_identity,
            &recipient.polycentric_identity,
            &vec![1u8; 32],
            &vec![2u8; 100],
            &vec![3u8; 12],
            timestamp,
            None,
        ).await.unwrap();
    }

    // Get first page (limit 3)
    let messages = setup.db.get_dm_history(
        &sender.polycentric_identity,
        &recipient.polycentric_identity,
        None,
        3,
    ).await.unwrap();

    assert_eq!(messages.len(), 3);

    // Get next page using cursor
    let cursor = messages.last().unwrap().created_at.to_rfc3339();
    let next_messages = setup.db.get_dm_history(
        &sender.polycentric_identity,
        &recipient.polycentric_identity,
        Some(&cursor),
        3,
    ).await.unwrap();

    assert_eq!(next_messages.len(), 2);
}

#[tokio::test]
async fn test_bidirectional_message_history() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let user1 = TestIdentity::new();
    let user2 = TestIdentity::new();

    // User1 sends to User2
    setup.db.store_message(
        "msg1",
        &user1.polycentric_identity,
        &user2.polycentric_identity,
        &vec![1u8; 32],
        &vec![2u8; 100],
        &vec![3u8; 12],
        Utc::now() - chrono::Duration::seconds(2),
        None,
    ).await.unwrap();

    // User2 sends to User1
    setup.db.store_message(
        "msg2",
        &user2.polycentric_identity,
        &user1.polycentric_identity,
        &vec![1u8; 32],
        &vec![2u8; 100],
        &vec![3u8; 12],
        Utc::now() - chrono::Duration::seconds(1),
        None,
    ).await.unwrap();

    // Both users should see both messages
    let messages1 = setup.db.get_dm_history(
        &user1.polycentric_identity,
        &user2.polycentric_identity,
        None,
        10,
    ).await.unwrap();

    let messages2 = setup.db.get_dm_history(
        &user2.polycentric_identity,
        &user1.polycentric_identity,
        None,
        10,
    ).await.unwrap();

    assert_eq!(messages1.len(), 2);
    assert_eq!(messages2.len(), 2);
    assert_eq!(messages1[0].message_id, messages2[0].message_id);
    assert_eq!(messages1[1].message_id, messages2[1].message_id);
}

#[tokio::test]
async fn test_message_delivery_tracking() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    let message_id = "test_delivery";
    let timestamp = Utc::now();

    // Store message
    setup.db.store_message(
        message_id,
        &sender.polycentric_identity,
        &recipient.polycentric_identity,
        &vec![1u8; 32],
        &vec![2u8; 100],
        &vec![3u8; 12],
        timestamp,
        None,
    ).await.unwrap();

    // Mark as delivered
    let delivered_at = Utc::now();
    setup.db.mark_message_delivered(message_id, delivered_at).await.unwrap();

    // Mark as read
    let read_at = Utc::now();
    setup.db.mark_message_read(message_id, read_at).await.unwrap();

    // Verify status
    let messages = setup.db.get_dm_history(
        &sender.polycentric_identity,
        &recipient.polycentric_identity,
        None,
        10,
    ).await.unwrap();

    assert_eq!(messages.len(), 1);
    let message = &messages[0];
    assert!(message.delivered_at.is_some());
    assert!(message.read_at.is_some());
}

#[tokio::test]
async fn test_connection_management() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    // Register connection
    setup.db.register_connection(
        connection_id,
        &identity.polycentric_identity,
        Some("test-user-agent"),
    ).await.unwrap();

    // Get user connections
    let connections = setup.db.get_user_connections(&identity.polycentric_identity).await.unwrap();
    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].connection_id, connection_id);
    assert_eq!(connections[0].user_agent, Some("test-user-agent".to_string()));

    // Update ping
    setup.db.update_connection_ping(connection_id).await.unwrap();

    // Remove connection
    setup.db.remove_connection(connection_id).await.unwrap();

    // Verify removal
    let connections = setup.db.get_user_connections(&identity.polycentric_identity).await.unwrap();
    assert_eq!(connections.len(), 0);
}

#[tokio::test]
async fn test_conversation_list() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let user1 = TestIdentity::new();
    let user2 = TestIdentity::new();
    let user3 = TestIdentity::new();

    let base_time = Utc::now();

    // User1 <-> User3 (older) - store this first
    setup.db.store_message(
        "msg2",
        &user1.polycentric_identity,
        &user3.polycentric_identity,
        &vec![1u8; 32],
        &vec![2u8; 100],
        &vec![3u8; 12],
        base_time - chrono::Duration::hours(1),
        None,
    ).await.unwrap();

    // User1 <-> User2 (most recent) - store this second
    setup.db.store_message(
        "msg1",
        &user1.polycentric_identity,
        &user2.polycentric_identity,
        &vec![1u8; 32],
        &vec![2u8; 100],
        &vec![3u8; 12],
        base_time,
        None,
    ).await.unwrap();

    // Get conversation list for user1
    let conversations = setup.db.get_conversation_list(&user1.polycentric_identity, 10).await.unwrap();

    assert_eq!(conversations.len(), 2);
    

    // Should be ordered by most recent
    assert_eq!(conversations[0].0.key_bytes, user2.polycentric_identity.key_bytes);
    assert_eq!(conversations[1].0.key_bytes, user3.polycentric_identity.key_bytes);
}

#[tokio::test]
async fn test_message_exists() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let sender = TestIdentity::new();
    let recipient = TestIdentity::new();

    let message_id = "test_exists";

    // Check non-existent message
    let exists = setup.db.message_exists(message_id).await.unwrap();
    assert!(!exists);

    // Store message
    setup.db.store_message(
        message_id,
        &sender.polycentric_identity,
        &recipient.polycentric_identity,
        &vec![1u8; 32],
        &vec![2u8; 100],
        &vec![3u8; 12],
        Utc::now(),
        None,
    ).await.unwrap();

    // Check existing message
    let exists = setup.db.message_exists(message_id).await.unwrap();
    assert!(exists);
}

#[tokio::test]
async fn test_cleanup_operations() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    // Create old connection
    setup.db.register_connection(connection_id, &identity.polycentric_identity, None).await.unwrap();

    // Manually set old ping time
    sqlx::query!(
        "UPDATE active_connections SET last_ping = NOW() - INTERVAL '1 hour' WHERE connection_id = $1",
        connection_id
    ).execute(&setup.pool).await.unwrap();

    // Cleanup stale connections (5 minute timeout)
    let cleaned = setup.db.cleanup_stale_connections(300).await.unwrap();
    assert_eq!(cleaned, 1);

    // Verify connection was removed
    let connections = setup.db.get_user_connections(&identity.polycentric_identity).await.unwrap();
    assert_eq!(connections.len(), 0);
}
