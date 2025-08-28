pub mod connection;
pub mod manager;

use serde_json;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use crate::models::{PolycentricIdentity, WSMessage};

pub type WebSocket = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;
pub type ConnectionSender = mpsc::UnboundedSender<Message>;

/// Manages all WebSocket connections
#[derive(Clone)]
pub struct WebSocketManager {
    connections: Arc<RwLock<HashMap<Uuid, ConnectionSender>>>,
    user_connections: Arc<RwLock<HashMap<PolycentricIdentity, Vec<Uuid>>>>,
}

impl WebSocketManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            user_connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a new WebSocket connection
    pub async fn register_connection(
        &self,
        connection_id: Uuid,
        identity: PolycentricIdentity,
        sender: ConnectionSender,
    ) {
        // Add to connections map
        self.connections.write().await.insert(connection_id, sender);

        // Add to user connections map
        self.user_connections
            .write()
            .await
            .entry(identity.clone())
            .or_insert_with(Vec::new)
            .push(connection_id);

        log::info!(
            "Registered WebSocket connection {} for identity {:?}",
            connection_id,
            identity
        );
    }

    /// Unregister a WebSocket connection
    pub async fn unregister_connection(&self, connection_id: Uuid) {
        // Remove from connections map
        self.connections.write().await.remove(&connection_id);

        // Remove from user connections map
        let mut user_connections = self.user_connections.write().await;
        user_connections.retain(|_identity, connections| {
            connections.retain(|&id| id != connection_id);
            !connections.is_empty()
        });

        log::info!("Unregistered WebSocket connection {}", connection_id);
    }

    /// Send a message to a specific user (all their connections)
    pub async fn send_to_user(&self, identity: &PolycentricIdentity, message: WSMessage) {
        let user_connections = self.user_connections.read().await;
        if let Some(connection_ids) = user_connections.get(identity) {
            let connections = self.connections.read().await;

            let message_json = match serde_json::to_string(&message) {
                Ok(json) => json,
                Err(e) => {
                    log::error!("Failed to serialize WebSocket message: {}", e);
                    return;
                }
            };

            for &connection_id in connection_ids {
                if let Some(sender) = connections.get(&connection_id) {
                    if let Err(e) = sender.send(Message::Text(message_json.clone())) {
                        log::warn!(
                            "Failed to send message to connection {}: {}",
                            connection_id,
                            e
                        );
                    }
                }
            }
        }
    }

    /// Send a message to a specific connection
    pub async fn send_to_connection(&self, connection_id: Uuid, message: WSMessage) {
        let connections = self.connections.read().await;
        if let Some(sender) = connections.get(&connection_id) {
            let message_json = match serde_json::to_string(&message) {
                Ok(json) => json,
                Err(e) => {
                    log::error!("Failed to serialize WebSocket message: {}", e);
                    return;
                }
            };

            if let Err(e) = sender.send(Message::Text(message_json)) {
                log::warn!(
                    "Failed to send message to connection {}: {}",
                    connection_id,
                    e
                );
            }
        }
    }

    /// Broadcast a message to all connections
    pub async fn broadcast(&self, message: WSMessage) {
        let connections = self.connections.read().await;

        let message_json = match serde_json::to_string(&message) {
            Ok(json) => json,
            Err(e) => {
                log::error!("Failed to serialize WebSocket message: {}", e);
                return;
            }
        };

        for (connection_id, sender) in connections.iter() {
            if let Err(e) = sender.send(Message::Text(message_json.clone())) {
                log::warn!("Failed to broadcast to connection {}: {}", connection_id, e);
            }
        }
    }

    /// Get connection count for a user
    pub async fn get_user_connection_count(&self, identity: &PolycentricIdentity) -> usize {
        let user_connections = self.user_connections.read().await;
        user_connections.get(identity).map(|c| c.len()).unwrap_or(0)
    }

    /// Check if a user is online (has active connections)
    pub async fn is_user_online(&self, identity: &PolycentricIdentity) -> bool {
        self.get_user_connection_count(identity).await > 0
    }

    /// Get all online users
    pub async fn get_online_users(&self) -> Vec<PolycentricIdentity> {
        let user_connections = self.user_connections.read().await;
        user_connections.keys().cloned().collect()
    }

    /// Get connection statistics
    pub async fn get_stats(&self) -> (usize, usize) {
        let connections = self.connections.read().await;
        let user_connections = self.user_connections.read().await;
        (connections.len(), user_connections.len())
    }
}
