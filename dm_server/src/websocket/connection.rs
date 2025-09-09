use chrono::Utc;
use futures::{SinkExt, StreamExt};
use serde_json;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::time::{interval, timeout};
use tokio_tungstenite::tungstenite::Message;
use tracing as log;
use uuid::Uuid;

use crate::crypto::DMCrypto;
use crate::db::DatabaseManager;

use super::{WebSocket, WebSocketManager};
use crate::models::{PolycentricIdentity, WSAuthChallenge, WSAuthResponse, WSMessage};

const PING_INTERVAL: Duration = Duration::from_secs(30);
const _PONG_TIMEOUT: Duration = Duration::from_secs(10);
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);

/// Handle a new WebSocket connection
pub async fn handle_websocket_connection(
    websocket: WebSocket,
    ws_manager: WebSocketManager,
    db: Arc<DatabaseManager>,
) {
    let connection_id = Uuid::new_v4();
    log::info!("New WebSocket connection: {}", connection_id);

    let (mut ws_sender, mut ws_receiver) = websocket.split();
    let (tx, mut rx) = mpsc::unbounded_channel();

    // Authentication challenge
    let challenge = DMCrypto::generate_challenge();
    let created_on = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let auth_challenge = WSAuthChallenge {
        challenge: challenge.to_vec(),
        created_on,
    };

    let _challenge_msg = WSMessage::ConnectionAck {
        connection_id: connection_id.to_string(),
    };

    if let Ok(challenge_json) = serde_json::to_string(&auth_challenge) {
        if let Err(e) = ws_sender.send(Message::Text(challenge_json)).await {
            log::error!("Failed to send auth challenge: {}", e);
            return;
        }
    } else {
        log::error!("Failed to serialize auth challenge");
        return;
    }

    // Wait for authentication response
    let identity = match timeout(
        AUTH_TIMEOUT,
        authenticate_connection(&mut ws_receiver, &challenge),
    )
    .await
    {
        Ok(Ok(identity)) => identity,
        Ok(Err(e)) => {
            log::warn!(
                "Authentication failed for connection {}: {}",
                connection_id,
                e
            );
            let _ = ws_sender
                .send(Message::Text(
                    serde_json::to_string(&WSMessage::Error {
                        message: "Authentication failed".to_string(),
                    })
                    .unwrap_or_default(),
                ))
                .await;
            return;
        }
        Err(_) => {
            log::warn!("Authentication timeout for connection {}", connection_id);
            return;
        }
    };

    log::info!(
        "WebSocket connection {} authenticated as {:?}",
        connection_id,
        identity
    );

    // Register connection in database
    if let Err(e) = db.register_connection(connection_id, &identity, None).await {
        log::error!("Failed to register connection in database: {}", e);
        return;
    }

    // Register with WebSocket manager
    ws_manager
        .register_connection(connection_id, identity.clone(), tx.clone())
        .await;

    // Send connection acknowledgment
    let ack_msg = WSMessage::ConnectionAck {
        connection_id: connection_id.to_string(),
    };
    if let Ok(ack_json) = serde_json::to_string(&ack_msg) {
        let _ = ws_sender.send(Message::Text(ack_json)).await;
    }

    // Deliver any pending messages
    if let Err(e) = deliver_pending_messages(&identity, &db, &ws_manager).await {
        log::error!("Failed to deliver pending messages: {}", e);
    }

    // Spawn tasks for handling the connection
    let ws_manager_clone = ws_manager.clone();
    let db_clone = db.clone();
    let identity_clone = identity.clone();

    // Task to handle outgoing messages
    let outgoing_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if let Err(e) = ws_sender.send(message).await {
                log::error!("WebSocket send error: {}", e);
                break;
            }
        }
    });

    // Task to handle incoming messages and ping/pong
    let incoming_task = tokio::spawn(async move {
        let mut ping_interval = interval(PING_INTERVAL);

        loop {
            tokio::select! {
                msg = ws_receiver.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            if let Err(e) = handle_websocket_message(&text, &identity_clone, &ws_manager_clone).await {
                                log::error!("Error handling WebSocket message: {}", e);
                            }
                        }
                        Some(Ok(Message::Pong(_))) => {
                            // Update ping timestamp in database
                            if let Err(e) = db_clone.update_connection_ping(connection_id).await {
                                log::error!("Failed to update ping timestamp: {}", e);
                            }
                        }
                        Some(Ok(Message::Close(_))) => {
                            log::info!("WebSocket connection {} closed by client", connection_id);
                            break;
                        }
                        Some(Err(e)) => {
                            log::error!("WebSocket error: {}", e);
                            break;
                        }
                        None => {
                            log::info!("WebSocket connection {} terminated", connection_id);
                            break;
                        }
                        _ => {}
                    }
                }
                _ = ping_interval.tick() => {
                    // Send ping
                    let ping_msg = WSMessage::Ping;
                    ws_manager_clone.send_to_connection(connection_id, ping_msg).await;
                }
            }
        }
    });

    // Wait for either task to complete
    tokio::select! {
        _ = outgoing_task => {},
        _ = incoming_task => {},
    }

    // Cleanup
    ws_manager.unregister_connection(connection_id).await;
    if let Err(e) = db.remove_connection(connection_id).await {
        log::error!("Failed to remove connection from database: {}", e);
    }

    log::info!("WebSocket connection {} cleaned up", connection_id);
}

/// Authenticate a WebSocket connection
async fn authenticate_connection(
    ws_receiver: &mut futures::stream::SplitStream<WebSocket>,
    challenge: &[u8],
) -> anyhow::Result<PolycentricIdentity> {
    if let Some(Ok(Message::Text(text))) = ws_receiver.next().await {
        let auth_response: WSAuthResponse = serde_json::from_str(&text)
            .map_err(|e| anyhow::anyhow!("Invalid auth response format: {}", e))?;

        // Verify the challenge matches
        if auth_response.challenge != challenge {
            return Err(anyhow::anyhow!("Challenge mismatch"));
        }

        // Verify the signature
        let verifying_key = auth_response
            .identity
            .verifying_key()
            .map_err(|e| anyhow::anyhow!("Invalid identity key: {}", e))?;

        DMCrypto::verify_signature(&verifying_key, challenge, &auth_response.signature)
            .map_err(|e| anyhow::anyhow!("Signature verification failed: {}", e))?;

        Ok(auth_response.identity)
    } else {
        Err(anyhow::anyhow!("No auth response received"))
    }
}

/// Handle incoming WebSocket messages
async fn handle_websocket_message(
    text: &str,
    sender_identity: &PolycentricIdentity,
    _ws_manager: &WebSocketManager,
) -> anyhow::Result<()> {
    let message: WSMessage =
        serde_json::from_str(text).map_err(|e| anyhow::anyhow!("Invalid message format: {}", e))?;

    match message {
        WSMessage::TypingIndicator {
            sender: _,
            is_typing,
        } => {
            // For typing indicators, we would typically need to know the recipient
            // This might require a separate message format or including recipient in the message
            log::debug!(
                "Received typing indicator from {:?}: {}",
                sender_identity,
                is_typing
            );
        }
        WSMessage::ReadReceipt {
            message_id,
            reader: _,
            read_timestamp: _,
        } => {
            // Handle read receipt
            log::debug!(
                "Received read receipt from {:?} for message {}",
                sender_identity,
                message_id
            );
        }
        WSMessage::Pong => {
            log::debug!("Received pong from {:?}", sender_identity);
        }
        _ => {
            log::warn!("Unexpected message type from {:?}", sender_identity);
        }
    }

    Ok(())
}

/// Deliver pending messages to a newly connected user
async fn deliver_pending_messages(
    identity: &PolycentricIdentity,
    db: &DatabaseManager,
    ws_manager: &WebSocketManager,
) -> anyhow::Result<()> {
    // Get messages since the user was last online (simplified - using last 24 hours)
    let since = Utc::now() - chrono::Duration::hours(24);

    let messages = db.get_undelivered_messages(identity, since).await?;

    for message in messages {
        let dm_response = crate::models::DMMessageResponse::from(message.clone());
        let ws_message = WSMessage::DMMessage {
            message: dm_response,
        };

        ws_manager.send_to_user(identity, ws_message).await;

        // Mark as delivered
        if let Err(e) = db
            .mark_message_delivered(&message.message_id, Utc::now())
            .await
        {
            log::error!(
                "Failed to mark message {} as delivered: {}",
                message.message_id,
                e
            );
        }
    }

    Ok(())
}

/// Handle a new WebSocket connection from axum
pub async fn handle_axum_websocket_connection(
    websocket: axum::extract::ws::WebSocket,
    ws_manager: WebSocketManager,
    _db: Arc<DatabaseManager>,
) {
    let connection_id = Uuid::new_v4();
    log::info!("New axum WebSocket connection: {}", connection_id);

    let (mut ws_sender, mut ws_receiver) = websocket.split();
    let (tx, mut rx) = mpsc::unbounded_channel();

    // Authentication challenge
    let challenge = DMCrypto::generate_challenge();
    let created_on = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let auth_challenge = WSAuthChallenge {
        challenge: challenge.to_vec(),
        created_on,
    };

    // Send connection ack with challenge
    if let Ok(challenge_json) = serde_json::to_string(&auth_challenge) {
        if let Err(e) = ws_sender
            .send(axum::extract::ws::Message::Text(challenge_json.into()))
            .await
        {
            log::error!("Failed to send challenge: {}", e);
            return;
        }
    }

    // Start ping task
    let mut ping_interval = interval(PING_INTERVAL);
    let mut authenticated = false;
    let mut _user_identity: Option<PolycentricIdentity> = None;

    loop {
        tokio::select! {
            // Handle incoming messages
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(axum::extract::ws::Message::Text(text))) => {
                        if !authenticated {
                            // Try to authenticate
                            if let Ok(auth_response) = serde_json::from_str::<WSAuthResponse>(&text) {
                                // Verify the challenge matches
                                if auth_response.challenge == challenge {
                                    // Verify the signature
                                    if let Ok(verifying_key) = auth_response.identity.verifying_key() {
                                        if DMCrypto::verify_signature(&verifying_key, &challenge, &auth_response.signature).is_ok() {
                                            authenticated = true;
                                            _user_identity = Some(auth_response.identity.clone());
                                            log::info!("WebSocket connection {} authenticated for user: {:?}", connection_id, auth_response.identity);

                                            // Register user with manager
                                            ws_manager.register_connection(connection_id, auth_response.identity, tx.clone()).await;
                                        } else {
                                            log::warn!("Signature verification failed for connection {}", connection_id);
                                            break;
                                        }
                                    } else {
                                        log::warn!("Invalid identity key for connection {}", connection_id);
                                        break;
                                    }
                                } else {
                                    log::warn!("Challenge mismatch for connection {}", connection_id);
                                    break;
                                }
                            } else {
                                log::warn!("Invalid auth response format from connection {}", connection_id);
                                break;
                            }
                        } else {
                            // Handle regular messages after authentication
                            if let Ok(ws_msg) = serde_json::from_str::<WSMessage>(&text) {
                                match ws_msg {
                                    WSMessage::Pong => {
                                        // Handle pong
                                    }
                                    _ => {
                                        log::debug!("Received message from connection {}: {:?}", connection_id, ws_msg);
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(axum::extract::ws::Message::Close(_))) => {
                        log::info!("WebSocket connection {} closed", connection_id);
                        break;
                    }
                    Some(Err(e)) => {
                        log::error!("WebSocket error for connection {}: {}", connection_id, e);
                        break;
                    }
                    None => {
                        log::info!("WebSocket connection {} disconnected", connection_id);
                        break;
                    }
                    _ => {}
                }
            }

            // Handle outgoing messages
            msg = rx.recv() => {
                match msg {
                    Some(msg) => {
                        let axum_msg = match msg {
                            Message::Text(text) => axum::extract::ws::Message::Text(text.into()),
                            Message::Binary(data) => axum::extract::ws::Message::Binary(data.into()),
                            Message::Ping(data) => axum::extract::ws::Message::Ping(data.into()),
                            Message::Pong(data) => axum::extract::ws::Message::Pong(data.into()),
                            Message::Close(_) => continue, // Skip close frames for now
                            Message::Frame(_) => continue, // Skip raw frames
                        };

                        if let Err(e) = ws_sender.send(axum_msg).await {
                            log::error!("Failed to send message to connection {}: {}", connection_id, e);
                            break;
                        }
                    }
                    None => {
                        log::info!("Connection {} sender dropped", connection_id);
                        break;
                    }
                }
            }

            // Send ping
            _ = ping_interval.tick() => {
                if let Err(e) = ws_sender.send(axum::extract::ws::Message::Ping(vec![].into())).await {
                    log::error!("Failed to send ping to connection {}: {}", connection_id, e);
                    break;
                }
            }
        }
    }

    // Cleanup
    ws_manager.unregister_connection(connection_id).await;

    log::info!("WebSocket connection {} cleaned up", connection_id);
}
