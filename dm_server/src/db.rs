use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::models::*;

/// Parameters for storing a DM message
#[derive(Debug)]
pub struct StoreMessageParams<'a> {
    pub message_id: &'a str,
    pub sender: &'a PolycentricIdentity,
    pub recipient: &'a PolycentricIdentity,
    pub ephemeral_public_key: &'a [u8],
    pub encrypted_content: &'a [u8],
    pub nonce: &'a [u8],
    pub encryption_algorithm: Option<&'a str>,
    pub message_timestamp: DateTime<Utc>,
    pub reply_to: Option<&'a str>,
}

/// Database operations for the DM server
pub struct DatabaseManager {
    pool: PgPool,
}

impl DatabaseManager {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Register or update a user's X25519 public key
    pub async fn register_x25519_key(
        &self,
        identity: &PolycentricIdentity,
        x25519_public_key: &[u8],
        signature: &[u8],
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO user_x25519_keys (identity_key_type, identity_key_bytes, x25519_public_key, signature)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (identity_key_type, identity_key_bytes)
            DO UPDATE SET 
                x25519_public_key = EXCLUDED.x25519_public_key,
                signature = EXCLUDED.signature,
                updated_at = NOW()
            "#,
            identity.key_type as i64,
            &identity.key_bytes,
            x25519_public_key,
            signature
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get a user's X25519 public key
    pub async fn get_x25519_key(
        &self,
        identity: &PolycentricIdentity,
    ) -> Result<Option<UserX25519Key>> {
        let row = sqlx::query_as!(
            UserX25519Key,
            r#"
            SELECT identity_key_type, identity_key_bytes, x25519_public_key, signature, created_at, updated_at
            FROM user_x25519_keys 
            WHERE identity_key_type = $1 AND identity_key_bytes = $2
            "#,
            identity.key_type as i64,
            &identity.key_bytes
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row)
    }

    /// Store an encrypted DM message
    pub async fn store_message(&self, params: StoreMessageParams<'_>) -> Result<Uuid> {
        let row = sqlx::query!(
            r#"
            INSERT INTO dm_messages (
                message_id, sender_key_type, sender_key_bytes, recipient_key_type, recipient_key_bytes,
                ephemeral_public_key, encrypted_content, nonce, encryption_algorithm, message_timestamp, reply_to_message_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
            "#,
            params.message_id,
            params.sender.key_type as i64,
            &params.sender.key_bytes,
            params.recipient.key_type as i64,
            &params.recipient.key_bytes,
            params.ephemeral_public_key,
            params.encrypted_content,
            params.nonce,
            params.encryption_algorithm.unwrap_or("ChaCha20Poly1305"),
            params.message_timestamp,
            params.reply_to,
        )
        .fetch_one(&self.pool)
        .await?;

        let id: Uuid = row.id;
        Ok(id)
    }

    /// Get DM history between two users
    pub async fn get_dm_history(
        &self,
        user1: &PolycentricIdentity,
        user2: &PolycentricIdentity,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DMMessage>> {
        let cursor_timestamp = if let Some(cursor) = cursor {
            Some(DateTime::parse_from_rfc3339(cursor)?.with_timezone(&Utc))
        } else {
            None
        };

        let messages = sqlx::query_as!(
            DMMessage,
            r#"
            SELECT id, message_id, sender_key_type, sender_key_bytes, recipient_key_type, recipient_key_bytes,
                   ephemeral_public_key, encrypted_content, nonce, encryption_algorithm, created_at, message_timestamp,
                   reply_to_message_id, delivered_at, read_at
            FROM dm_messages
            WHERE (
                (sender_key_type = $1 AND sender_key_bytes = $2 AND recipient_key_type = $3 AND recipient_key_bytes = $4)
                OR
                (sender_key_type = $3 AND sender_key_bytes = $4 AND recipient_key_type = $1 AND recipient_key_bytes = $2)
            )
            AND ($5::timestamptz IS NULL OR created_at < $5)
            ORDER BY created_at DESC
            LIMIT $6
            "#,
            user1.key_type as i64,
            &user1.key_bytes,
            user2.key_type as i64,
            &user2.key_bytes,
            cursor_timestamp,
            limit as i64
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(messages)
    }

    /// Get messages for a specific recipient (for delivery)
    pub async fn get_undelivered_messages(
        &self,
        recipient: &PolycentricIdentity,
        since: DateTime<Utc>,
    ) -> Result<Vec<DMMessage>> {
        let messages = sqlx::query_as!(
            DMMessage,
            r#"
            SELECT id, message_id, sender_key_type, sender_key_bytes, recipient_key_type, recipient_key_bytes,
                   ephemeral_public_key, encrypted_content, nonce, encryption_algorithm, created_at, message_timestamp,
                   reply_to_message_id, delivered_at, read_at
            FROM dm_messages
            WHERE recipient_key_type = $1 AND recipient_key_bytes = $2
            AND created_at > $3
            AND delivered_at IS NULL
            ORDER BY created_at ASC
            "#,
            recipient.key_type as i64,
            &recipient.key_bytes,
            since,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(messages)
    }

    /// Mark a message as delivered
    pub async fn mark_message_delivered(
        &self,
        message_id: &str,
        delivered_at: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE dm_messages
            SET delivered_at = $2
            WHERE message_id = $1 AND delivered_at IS NULL
            "#,
            message_id,
            delivered_at
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Mark a message as read
    pub async fn mark_message_read(&self, message_id: &str, read_at: DateTime<Utc>) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE dm_messages
            SET read_at = $2
            WHERE message_id = $1 AND read_at IS NULL
            "#,
            message_id,
            read_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Register an active WebSocket connection
    pub async fn register_connection(
        &self,
        connection_id: Uuid,
        identity: &PolycentricIdentity,
        user_agent: Option<&str>,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO active_connections (connection_id, identity_key_type, identity_key_bytes, user_agent)
            VALUES ($1, $2, $3, $4)
            "#,
            connection_id,
            identity.key_type as i64,
            &identity.key_bytes,
            user_agent
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Remove an active WebSocket connection
    pub async fn remove_connection(&self, connection_id: Uuid) -> Result<()> {
        sqlx::query!(
            r#"
            DELETE FROM active_connections
            WHERE connection_id = $1
            "#,
            connection_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Update connection ping timestamp
    pub async fn update_connection_ping(&self, connection_id: Uuid) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE active_connections
            SET last_ping = NOW()
            WHERE connection_id = $1
            "#,
            connection_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get all active connections for a user
    pub async fn get_user_connections(
        &self,
        identity: &PolycentricIdentity,
    ) -> Result<Vec<ActiveConnection>> {
        let connections = sqlx::query_as!(
            ActiveConnection,
            r#"
            SELECT connection_id, identity_key_type, identity_key_bytes, connected_at, last_ping, user_agent
            FROM active_connections
            WHERE identity_key_type = $1 AND identity_key_bytes = $2
            ORDER BY connected_at DESC
            "#,
            identity.key_type as i64,
            &identity.key_bytes
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(connections)
    }

    /// Clean up stale connections
    pub async fn cleanup_stale_connections(&self, timeout_seconds: i64) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            DELETE FROM active_connections
            WHERE last_ping < NOW() - INTERVAL '1 second' * $1
            "#,
            timeout_seconds as f64
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Clean up old messages
    pub async fn cleanup_old_messages(&self, retention_days: i32) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            DELETE FROM dm_messages
            WHERE created_at < NOW() - INTERVAL '1 day' * $1
            "#,
            retention_days as f64
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Get conversation list for a user (most recent message per conversation)
    pub async fn get_conversation_list(
        &self,
        user: &PolycentricIdentity,
        limit: u32,
    ) -> Result<Vec<(PolycentricIdentity, DateTime<Utc>)>> {
        let rows = sqlx::query!(
            r#"
            WITH conversations AS (
                SELECT 
                    CASE 
                        WHEN sender_key_type = $1 AND sender_key_bytes = $2 
                        THEN recipient_key_type 
                        ELSE sender_key_type 
                    END as other_key_type,
                    CASE 
                        WHEN sender_key_type = $1 AND sender_key_bytes = $2 
                        THEN recipient_key_bytes 
                        ELSE sender_key_bytes 
                    END as other_key_bytes,
                    MAX(created_at) as last_message_at
                FROM dm_messages
                WHERE (sender_key_type = $1 AND sender_key_bytes = $2)
                    OR (recipient_key_type = $1 AND recipient_key_bytes = $2)
                GROUP BY other_key_type, other_key_bytes
            )
            SELECT other_key_type, other_key_bytes, last_message_at
            FROM conversations
            ORDER BY last_message_at DESC
            LIMIT $3
            "#,
            user.key_type as i64,
            &user.key_bytes,
            limit as i64
        )
        .fetch_all(&self.pool)
        .await?;

        let conversations = rows
            .into_iter()
            .filter_map(|row| {
                let key_type: Option<i64> = row.other_key_type;
                let key_bytes: Option<Vec<u8>> = row.other_key_bytes;
                let last_message_at: Option<DateTime<Utc>> = row.last_message_at;

                if let (Some(key_type), Some(key_bytes), Some(last_message_at)) =
                    (key_type, key_bytes, last_message_at)
                {
                    let identity = PolycentricIdentity::new(key_type as u64, key_bytes);
                    Some((identity, last_message_at))
                } else {
                    None
                }
            })
            .collect();

        Ok(conversations)
    }

    /// Get detailed conversation list with last message and unread count
    pub async fn get_detailed_conversation_list(
        &self,
        user: &PolycentricIdentity,
        limit: u32,
    ) -> Result<Vec<ConversationSummary>> {
        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT ON (
                CASE 
                    WHEN sender_key_type = $1 AND sender_key_bytes = $2 
                    THEN recipient_key_type 
                    ELSE sender_key_type 
                END,
                CASE 
                    WHEN sender_key_type = $1 AND sender_key_bytes = $2 
                    THEN recipient_key_bytes 
                    ELSE sender_key_bytes 
                END
            )
                CASE 
                    WHEN sender_key_type = $1 AND sender_key_bytes = $2 
                    THEN recipient_key_type 
                    ELSE sender_key_type 
                END as conversation_key_type,
                CASE 
                    WHEN sender_key_type = $1 AND sender_key_bytes = $2 
                    THEN recipient_key_bytes 
                    ELSE sender_key_bytes 
                END as conversation_key_bytes,
                message_id,
                sender_key_type,
                sender_key_bytes,
                encrypted_content,
                nonce,
                encryption_algorithm,
                created_at,
                CASE 
                    WHEN sender_key_type = $1 AND sender_key_bytes = $2 
                    THEN false 
                    ELSE true 
                END as is_from_other
            FROM dm_messages
            WHERE sender_key_type = $1 AND sender_key_bytes = $2
               OR recipient_key_type = $1 AND recipient_key_bytes = $2
            ORDER BY 
                conversation_key_type, 
                conversation_key_bytes, 
                created_at DESC
            LIMIT $3
            "#,
            user.key_type as i64,
            &user.key_bytes,
            limit as i64
        )
        .fetch_all(&self.pool)
        .await?;

        let conversations = rows
            .into_iter()
            .filter_map(|row| {
                let key_type: Option<i64> = row.conversation_key_type;
                let key_bytes: Option<Vec<u8>> = row.conversation_key_bytes;
                let message_id: String = row.message_id;
                let sender_key_type: i64 = row.sender_key_type;
                let sender_key_bytes: Vec<u8> = row.sender_key_bytes;
                let encrypted_content: Vec<u8> = row.encrypted_content;
                let nonce: Vec<u8> = row.nonce;
                let encryption_algorithm: String = row.encryption_algorithm;
                let created_at: DateTime<Utc> = row.created_at;
                let is_from_other: Option<bool> = row.is_from_other;

                if let (
                    Some(key_type),
                    Some(key_bytes),
                    message_id,
                    sender_key_type,
                    sender_key_bytes,
                    encrypted_content,
                    nonce,
                    encryption_algorithm,
                    created_at,
                    Some(is_from_other),
                ) = (
                    key_type,
                    key_bytes,
                    message_id,
                    sender_key_type,
                    sender_key_bytes,
                    encrypted_content,
                    nonce,
                    encryption_algorithm,
                    created_at,
                    is_from_other,
                ) {
                    let other_identity = PolycentricIdentity::new(key_type as u64, key_bytes);
                    let sender_identity =
                        PolycentricIdentity::new(sender_key_type as u64, sender_key_bytes);

                    let last_message = if is_from_other {
                        Some(LastMessageInfo {
                            message_id,
                            sender: sender_identity,
                            encrypted_content,
                            nonce,
                            encryption_algorithm: encryption_algorithm.clone(),
                            timestamp: created_at,
                        })
                    } else {
                        None
                    };

                    Some(ConversationSummary {
                        other_party: other_identity,
                        last_message,
                        last_activity: created_at,
                        unread_count: 0, // TODO: Implement unread count
                    })
                } else {
                    None
                }
            })
            .collect();

        Ok(conversations)
    }

    /// Check if a message exists
    pub async fn message_exists(&self, message_id: &str) -> Result<bool> {
        let row = sqlx::query!(
            r#"
            SELECT EXISTS(SELECT 1 FROM dm_messages WHERE message_id = $1) as exists
            "#,
            message_id
        )
        .fetch_one(&self.pool)
        .await?;

        let exists: bool = row.exists.unwrap_or(false);
        Ok(exists)
    }
}
