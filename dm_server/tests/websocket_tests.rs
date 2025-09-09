use serial_test::serial;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

mod common;
use common::TestIdentity;

use dm_server::models::{DMMessageResponse, WSMessage};
use dm_server::websocket::WebSocketManager;

#[tokio::test]
#[serial]
async fn test_websocket_manager_registration() {
    let ws_manager = WebSocketManager::new();
    let identity = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    let (tx, _rx) = mpsc::unbounded_channel();

    // Test connection registration
    ws_manager
        .register_connection(connection_id, identity.polycentric_identity.clone(), tx)
        .await;

    // Test user is online
    let is_online = ws_manager
        .is_user_online(&identity.polycentric_identity)
        .await;
    assert!(is_online);

    // Test connection count
    let count = ws_manager
        .get_user_connection_count(&identity.polycentric_identity)
        .await;
    assert_eq!(count, 1);

    // Test unregistration
    ws_manager.unregister_connection(connection_id).await;

    let is_online = ws_manager
        .is_user_online(&identity.polycentric_identity)
        .await;
    assert!(!is_online);

    let count = ws_manager
        .get_user_connection_count(&identity.polycentric_identity)
        .await;
    assert_eq!(count, 0);
}

#[tokio::test]
#[serial]
async fn test_websocket_manager_multiple_connections() {
    let ws_manager = WebSocketManager::new();
    let identity = TestIdentity::new();

    let connection_id1 = Uuid::new_v4();
    let connection_id2 = Uuid::new_v4();

    let (tx1, _rx1) = mpsc::unbounded_channel();
    let (tx2, _rx2) = mpsc::unbounded_channel();

    // Register multiple connections for same user
    ws_manager
        .register_connection(connection_id1, identity.polycentric_identity.clone(), tx1)
        .await;

    ws_manager
        .register_connection(connection_id2, identity.polycentric_identity.clone(), tx2)
        .await;

    // Test connection count
    let count = ws_manager
        .get_user_connection_count(&identity.polycentric_identity)
        .await;
    assert_eq!(count, 2);

    // Unregister one connection
    ws_manager.unregister_connection(connection_id1).await;

    let count = ws_manager
        .get_user_connection_count(&identity.polycentric_identity)
        .await;
    assert_eq!(count, 1);

    let is_online = ws_manager
        .is_user_online(&identity.polycentric_identity)
        .await;
    assert!(is_online);

    // Unregister last connection
    ws_manager.unregister_connection(connection_id2).await;

    let count = ws_manager
        .get_user_connection_count(&identity.polycentric_identity)
        .await;
    assert_eq!(count, 0);

    let is_online = ws_manager
        .is_user_online(&identity.polycentric_identity)
        .await;
    assert!(!is_online);
}

#[tokio::test]
#[serial]
async fn test_websocket_message_sending() {
    let ws_manager = WebSocketManager::new();
    let identity = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    let (tx, mut rx) = mpsc::unbounded_channel();

    // Register connection
    ws_manager
        .register_connection(connection_id, identity.polycentric_identity.clone(), tx)
        .await;

    // Send message to user
    let test_message = WSMessage::ConnectionAck {
        connection_id: connection_id.to_string(),
    };

    ws_manager
        .send_to_user(&identity.polycentric_identity, test_message.clone())
        .await;

    // Verify message was received
    let received = rx.recv().await;
    assert!(received.is_some());

    if let Some(Message::Text(text)) = received {
        let parsed: WSMessage = serde_json::from_str(&text).unwrap();
        match parsed {
            WSMessage::ConnectionAck {
                connection_id: received_id,
            } => {
                assert_eq!(received_id, connection_id.to_string());
            }
            _ => panic!("Wrong message type received"),
        }
    } else {
        panic!("Expected text message");
    }
}

#[tokio::test]
#[serial]
async fn test_websocket_send_to_specific_connection() {
    let ws_manager = WebSocketManager::new();
    let identity = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    let (tx, mut rx) = mpsc::unbounded_channel();

    // Register connection
    ws_manager
        .register_connection(connection_id, identity.polycentric_identity.clone(), tx)
        .await;

    // Send message to specific connection
    let test_message = WSMessage::Ping;
    ws_manager
        .send_to_connection(connection_id, test_message)
        .await;

    // Verify message was received
    let received = rx.recv().await;
    assert!(received.is_some());

    if let Some(Message::Text(text)) = received {
        let parsed: WSMessage = serde_json::from_str(&text).unwrap();
        match parsed {
            WSMessage::Ping => {} // Expected
            _ => panic!("Wrong message type received"),
        }
    } else {
        panic!("Expected text message");
    }
}

#[tokio::test]
#[serial]
async fn test_websocket_broadcast() {
    let ws_manager = WebSocketManager::new();
    let identity1 = TestIdentity::new();
    let identity2 = TestIdentity::new();

    let connection_id1 = Uuid::new_v4();
    let connection_id2 = Uuid::new_v4();

    let (tx1, mut rx1) = mpsc::unbounded_channel();
    let (tx2, mut rx2) = mpsc::unbounded_channel();

    // Register multiple connections
    ws_manager
        .register_connection(connection_id1, identity1.polycentric_identity.clone(), tx1)
        .await;

    ws_manager
        .register_connection(connection_id2, identity2.polycentric_identity.clone(), tx2)
        .await;

    // Broadcast message
    let test_message = WSMessage::Pong;
    ws_manager.broadcast(test_message).await;

    // Verify both connections received the message
    let received1 = rx1.recv().await;
    let received2 = rx2.recv().await;

    assert!(received1.is_some());
    assert!(received2.is_some());

    for received in [received1, received2] {
        if let Some(Message::Text(text)) = received {
            let parsed: WSMessage = serde_json::from_str(&text).unwrap();
            match parsed {
                WSMessage::Pong => {} // Expected
                _ => panic!("Wrong message type received"),
            }
        } else {
            panic!("Expected text message");
        }
    }
}

#[tokio::test]
#[serial]
async fn test_websocket_manager_stats() {
    let ws_manager = WebSocketManager::new();
    let identity1 = TestIdentity::new();
    let identity2 = TestIdentity::new();

    let connection_id1 = Uuid::new_v4();
    let connection_id2 = Uuid::new_v4();
    let connection_id3 = Uuid::new_v4();

    let (tx1, _rx1) = mpsc::unbounded_channel();
    let (tx2, _rx2) = mpsc::unbounded_channel();
    let (tx3, _rx3) = mpsc::unbounded_channel();

    // Register connections
    ws_manager
        .register_connection(connection_id1, identity1.polycentric_identity.clone(), tx1)
        .await;
    ws_manager
        .register_connection(connection_id2, identity1.polycentric_identity.clone(), tx2)
        .await;
    ws_manager
        .register_connection(connection_id3, identity2.polycentric_identity.clone(), tx3)
        .await;

    // Test stats
    let (total_connections, unique_users) = ws_manager.get_stats().await;
    assert_eq!(total_connections, 3);
    assert_eq!(unique_users, 2);

    // Test online users
    let online_users = ws_manager.get_online_users().await;
    assert_eq!(online_users.len(), 2);
    assert!(online_users.contains(&identity1.polycentric_identity));
    assert!(online_users.contains(&identity2.polycentric_identity));
}

#[tokio::test]
#[serial]
async fn test_websocket_dm_message() {
    let ws_manager = WebSocketManager::new();
    let recipient = TestIdentity::new();
    let sender = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    let (tx, mut rx) = mpsc::unbounded_channel();

    // Register recipient connection
    ws_manager
        .register_connection(connection_id, recipient.polycentric_identity.clone(), tx)
        .await;

    // Create a DM message
    let dm_message = DMMessageResponse {
        message_id: "test_msg_123".to_string(),
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

    // Send DM message to recipient
    ws_manager
        .send_to_user(&recipient.polycentric_identity, ws_message)
        .await;

    // Verify message was received
    let received = rx.recv().await;
    assert!(received.is_some());

    if let Some(Message::Text(text)) = received {
        let parsed: WSMessage = serde_json::from_str(&text).unwrap();
        match parsed {
            WSMessage::DMMessage { message } => {
                assert_eq!(message.message_id, dm_message.message_id);
                assert_eq!(
                    message.sender.key_bytes,
                    sender.polycentric_identity.key_bytes
                );
                assert_eq!(
                    message.recipient.key_bytes,
                    recipient.polycentric_identity.key_bytes
                );
            }
            _ => panic!("Wrong message type received"),
        }
    } else {
        panic!("Expected text message");
    }
}

#[tokio::test]
#[serial]
async fn test_websocket_typing_indicator() {
    let ws_manager = WebSocketManager::new();
    let user = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    let (tx, mut rx) = mpsc::unbounded_channel();

    // Register connection
    ws_manager
        .register_connection(connection_id, user.polycentric_identity.clone(), tx)
        .await;

    // Send typing indicator
    let typing_message = WSMessage::TypingIndicator {
        sender: user.polycentric_identity.clone(),
        is_typing: true,
    };

    ws_manager
        .send_to_user(&user.polycentric_identity, typing_message)
        .await;

    // Verify message was received
    let received = rx.recv().await;
    assert!(received.is_some());

    if let Some(Message::Text(text)) = received {
        let parsed: WSMessage = serde_json::from_str(&text).unwrap();
        match parsed {
            WSMessage::TypingIndicator { sender, is_typing } => {
                assert_eq!(sender.key_bytes, user.polycentric_identity.key_bytes);
                assert!(is_typing);
            }
            _ => panic!("Wrong message type received"),
        }
    } else {
        panic!("Expected text message");
    }
}

#[tokio::test]
#[serial]
async fn test_websocket_read_receipt() {
    let ws_manager = WebSocketManager::new();
    let user = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    let (tx, mut rx) = mpsc::unbounded_channel();

    // Register connection
    ws_manager
        .register_connection(connection_id, user.polycentric_identity.clone(), tx)
        .await;

    // Send read receipt
    let read_receipt = WSMessage::ReadReceipt {
        message_id: "test_msg_123".to_string(),
        reader: user.polycentric_identity.clone(),
        read_timestamp: chrono::Utc::now(),
    };

    ws_manager
        .send_to_user(&user.polycentric_identity, read_receipt)
        .await;

    // Verify message was received
    let received = rx.recv().await;
    assert!(received.is_some());

    if let Some(Message::Text(text)) = received {
        let parsed: WSMessage = serde_json::from_str(&text).unwrap();
        match parsed {
            WSMessage::ReadReceipt {
                message_id,
                reader,
                read_timestamp: _,
            } => {
                assert_eq!(message_id, "test_msg_123");
                assert_eq!(reader.key_bytes, user.polycentric_identity.key_bytes);
            }
            _ => panic!("Wrong message type received"),
        }
    } else {
        panic!("Expected text message");
    }
}

#[tokio::test]
#[serial]
async fn test_websocket_error_message() {
    let ws_manager = WebSocketManager::new();
    let user = TestIdentity::new();
    let connection_id = Uuid::new_v4();

    let (tx, mut rx) = mpsc::unbounded_channel();

    // Register connection
    ws_manager
        .register_connection(connection_id, user.polycentric_identity.clone(), tx)
        .await;

    // Send error message
    let error_message = WSMessage::Error {
        message: "Test error message".to_string(),
    };

    ws_manager
        .send_to_connection(connection_id, error_message)
        .await;

    // Verify message was received
    let received = rx.recv().await;
    assert!(received.is_some());

    if let Some(Message::Text(text)) = received {
        let parsed: WSMessage = serde_json::from_str(&text).unwrap();
        match parsed {
            WSMessage::Error { message } => {
                assert_eq!(message, "Test error message");
            }
            _ => panic!("Wrong message type received"),
        }
    } else {
        panic!("Expected text message");
    }
}
