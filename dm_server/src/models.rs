use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Represents a user's X25519 public key for DM encryption
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct UserX25519Key {
    pub identity_key_type: i64,
    pub identity_key_bytes: Vec<u8>,
    pub x25519_public_key: Vec<u8>,
    pub signature: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Represents an encrypted DM message in the database
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct DMMessage {
    pub id: Uuid,
    pub message_id: String,
    pub sender_key_type: i64,
    pub sender_key_bytes: Vec<u8>,
    pub recipient_key_type: i64,
    pub recipient_key_bytes: Vec<u8>,
    pub ephemeral_public_key: Vec<u8>,
    pub encrypted_content: Vec<u8>,
    pub nonce: Vec<u8>,
    pub encryption_algorithm: String, // 'ChaCha20Poly1305' or 'Aes256Gcm'
    pub created_at: DateTime<Utc>,
    pub message_timestamp: DateTime<Utc>,
    pub reply_to_message_id: Option<String>,
    pub delivered_at: Option<DateTime<Utc>>,
    pub read_at: Option<DateTime<Utc>>,
}

/// Represents an active WebSocket connection
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ActiveConnection {
    pub connection_id: Uuid,
    pub identity_key_type: i64,
    pub identity_key_bytes: Vec<u8>,
    pub connected_at: DateTime<Utc>,
    pub last_ping: DateTime<Utc>,
    pub user_agent: Option<String>,
}

/// Represents message delivery status
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MessageDelivery {
    pub message_id: String,
    pub recipient_key_type: i64,
    pub recipient_key_bytes: Vec<u8>,
    pub status: String, // 'sent', 'delivered', 'read'
    pub timestamp: DateTime<Utc>,
}

/// Configuration for DM server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DMServerConfig {
    pub database_url: String,
    pub server_port: u16,
    pub websocket_port: u16,
    pub challenge_key: String,
    pub max_message_size: usize,
    pub message_retention_days: i32,
    pub max_connections_per_user: usize,
}

impl Default for DMServerConfig {
    fn default() -> Self {
        Self {
            database_url: "postgresql://localhost/dm_server".to_string(),
            server_port: 8080,
            websocket_port: 8081,
            challenge_key: "default-challenge-key".to_string(),
            max_message_size: 1024 * 1024, // 1MB
            message_retention_days: 30,
            max_connections_per_user: 5,
        }
    }
}

/// Polycentric identity wrapper
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct PolycentricIdentity {
    pub key_type: u64,
    pub key_bytes: Vec<u8>,
}

impl PolycentricIdentity {
    pub fn new(key_type: u64, key_bytes: Vec<u8>) -> Self {
        Self {
            key_type,
            key_bytes,
        }
    }

    /// Convert from polycentric-protocol PublicKey
    pub fn from_polycentric_key(key: &polycentric_protocol::model::public_key::PublicKey) -> Self {
        Self {
            key_type: polycentric_protocol::model::public_key::get_key_type(key),
            key_bytes: polycentric_protocol::model::public_key::get_key_bytes(key),
        }
    }

    /// Convert to polycentric-protocol PublicKey
    pub fn to_polycentric_key(
        &self,
    ) -> anyhow::Result<polycentric_protocol::model::public_key::PublicKey> {
        polycentric_protocol::model::public_key::from_type_and_bytes(self.key_type, &self.key_bytes)
    }

    /// Get Ed25519 verifying key for signature verification
    pub fn verifying_key(&self) -> anyhow::Result<ed25519_dalek::VerifyingKey> {
        if self.key_type != 1 {
            return Err(anyhow::anyhow!("Unsupported key type: {}", self.key_type));
        }

        crate::crypto::DMCrypto::verifying_key_from_bytes(&self.key_bytes)
    }
}

/// Request/Response types for API endpoints
#[derive(Debug, Serialize, Deserialize)]
pub struct SendDMRequest {
    pub recipient: PolycentricIdentity,
    pub ephemeral_public_key: Vec<u8>,
    pub encrypted_content: Vec<u8>,
    pub nonce: Vec<u8>,
    pub encryption_algorithm: Option<String>, // 'ChaCha20Poly1305' or 'Aes256Gcm', optional for backward compatibility
    pub message_id: String,
    pub reply_to: Option<String>,
    pub signature: Vec<u8>, // Signature by sender's identity key
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendDMResponse {
    pub success: bool,
    pub error: Option<String>,
    pub message_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetDMHistoryRequest {
    pub other_party: PolycentricIdentity,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetDMHistoryResponse {
    pub messages: Vec<DMMessageResponse>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DMMessageResponse {
    pub message_id: String,
    pub sender: PolycentricIdentity,
    pub recipient: PolycentricIdentity,
    pub ephemeral_public_key: Vec<u8>,
    pub encrypted_content: Vec<u8>,
    pub nonce: Vec<u8>,
    pub encryption_algorithm: String, // 'ChaCha20Poly1305' or 'Aes256Gcm'
    pub timestamp: DateTime<Utc>,
    pub reply_to: Option<String>,
}

impl From<DMMessage> for DMMessageResponse {
    fn from(msg: DMMessage) -> Self {
        Self {
            message_id: msg.message_id,
            sender: PolycentricIdentity::new(msg.sender_key_type as u64, msg.sender_key_bytes),
            recipient: PolycentricIdentity::new(
                msg.recipient_key_type as u64,
                msg.recipient_key_bytes,
            ),
            ephemeral_public_key: msg.ephemeral_public_key,
            encrypted_content: msg.encrypted_content,
            nonce: msg.nonce,
            encryption_algorithm: msg.encryption_algorithm,
            timestamp: msg.message_timestamp,
            reply_to: msg.reply_to_message_id,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterX25519KeyRequest {
    pub x25519_public_key: Vec<u8>,
    pub signature: Vec<u8>, // Signature of X25519 key by identity key
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterX25519KeyResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetX25519KeyRequest {
    pub identity: PolycentricIdentity,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetX25519KeyResponse {
    pub found: bool,
    pub x25519_public_key: Option<Vec<u8>>,
    pub timestamp: Option<DateTime<Utc>>,
}

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WSMessage {
    #[serde(rename = "dm_message")]
    DMMessage { message: DMMessageResponse },
    #[serde(rename = "typing_indicator")]
    TypingIndicator {
        sender: PolycentricIdentity,
        is_typing: bool,
    },
    #[serde(rename = "read_receipt")]
    ReadReceipt {
        message_id: String,
        reader: PolycentricIdentity,
        read_timestamp: DateTime<Utc>,
    },
    #[serde(rename = "connection_ack")]
    ConnectionAck { connection_id: String },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "pong")]
    Pong,
}

/// Authentication challenge for WebSocket connections
#[derive(Debug, Serialize, Deserialize)]
pub struct WSAuthChallenge {
    pub challenge: Vec<u8>,
    pub created_on: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WSAuthResponse {
    pub identity: PolycentricIdentity,
    pub signature: Vec<u8>,
    pub challenge: Vec<u8>,
}

/// Information about the last message in a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastMessageInfo {
    pub message_id: String,
    pub sender: PolycentricIdentity,
    pub encrypted_content: Vec<u8>,
    pub nonce: Vec<u8>,
    pub encryption_algorithm: String,
    pub timestamp: DateTime<Utc>,
}

/// Summary of a conversation for the conversation list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub other_party: PolycentricIdentity,
    pub last_message: Option<LastMessageInfo>,
    pub last_activity: DateTime<Utc>,
    pub unread_count: u32,
}

/// Response for getting conversations
#[derive(Debug, Serialize, Deserialize)]
pub struct GetConversationsResponse {
    pub conversations: Vec<ConversationSummary>,
}
