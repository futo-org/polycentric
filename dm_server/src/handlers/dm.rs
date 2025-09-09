use axum::{extract::State, Json};
use chrono::Utc;
use tracing as log;

use super::{auth::AuthError, AppState};
use crate::config::CONFIG;
use crate::crypto::DMCrypto;
use crate::models::*;

/// Send a direct message
pub async fn send_dm(
    sender: PolycentricIdentity,
    State(state): State<AppState>,
    Json(request): Json<SendDMRequest>,
) -> Result<Json<SendDMResponse>, AuthError> {
    // Validate message size
    if request.encrypted_content.len() > CONFIG.max_message_size {
        let response = SendDMResponse {
            success: false,
            error: Some("Message too large".to_string()),
            message_id: None,
        };
        return Ok(Json(response));
    }

    // Validate ephemeral key length
    if request.ephemeral_public_key.len() != 32 {
        let response = SendDMResponse {
            success: false,
            error: Some("Invalid ephemeral key length".to_string()),
            message_id: None,
        };
        return Ok(Json(response));
    }

    // Validate nonce length
    if request.nonce.len() != 12 {
        let response = SendDMResponse {
            success: false,
            error: Some("Invalid nonce length".to_string()),
            message_id: None,
        };
        return Ok(Json(response));
    }

    // Check if message ID already exists (prevent duplicates)
    match state.db.message_exists(&request.message_id).await {
        Ok(true) => {
            let response = SendDMResponse {
                success: false,
                error: Some("Message ID already exists".to_string()),
                message_id: None,
            };
            return Ok(Json(response));
        }
        Ok(false) => {} // Continue
        Err(e) => {
            log::error!("Failed to check message existence: {}", e);
            let response = SendDMResponse {
                success: false,
                error: Some("Database error".to_string()),
                message_id: None,
            };
            return Ok(Json(response));
        }
    }

    // Verify signature - use concatenated byte format to match client
    // Format: [message_id_bytes][sender_key_type][sender_key_bytes][recipient_key_type][recipient_key_bytes][ephemeral_key][encrypted_content][nonce]

    let message_id_bytes = request.message_id.as_bytes();
    let mut message_data = Vec::new();

    // Add message_id bytes
    message_data.extend_from_slice(message_id_bytes);

    // Add sender key_type (u64, little-endian)
    message_data.extend_from_slice(&sender.key_type.to_le_bytes());

    // Add sender key_bytes
    message_data.extend_from_slice(&sender.key_bytes);

    // Add recipient key_type (u64, little-endian)
    message_data.extend_from_slice(&request.recipient.key_type.to_le_bytes());

    // Add recipient key_bytes
    message_data.extend_from_slice(&request.recipient.key_bytes);

    // Add ephemeral public key
    message_data.extend_from_slice(&request.ephemeral_public_key);

    // Add encrypted content
    message_data.extend_from_slice(&request.encrypted_content);

    // Add nonce
    message_data.extend_from_slice(&request.nonce);

    let verifying_key = sender.verifying_key().map_err(|e| {
        log::error!("Invalid sender key: {}", e);
        AuthError::InternalError
    })?;

    if let Err(e) = DMCrypto::verify_signature(&verifying_key, &message_data, &request.signature) {
        log::warn!("Message signature verification failed: {}", e);
        return Err(AuthError::InternalError);
    }

    // Check that recipient has registered an X25519 key
    match state.db.get_x25519_key(&request.recipient).await {
        Ok(Some(_)) => {} // Recipient is ready to receive DMs
        Ok(None) => {
            let response = SendDMResponse {
                success: false,
                error: Some("Recipient has not registered for DMs".to_string()),
                message_id: None,
            };
            return Ok(Json(response));
        }
        Err(e) => {
            log::error!("Failed to check recipient key: {}", e);
            let response = SendDMResponse {
                success: false,
                error: Some("Database error".to_string()),
                message_id: None,
            };
            return Ok(Json(response));
        }
    }

    // Store the message
    let message_timestamp = Utc::now();
    match state
        .db
        .store_message(crate::db::StoreMessageParams {
            message_id: &request.message_id,
            sender: &sender,
            recipient: &request.recipient,
            ephemeral_public_key: &request.ephemeral_public_key,
            encrypted_content: &request.encrypted_content,
            nonce: &request.nonce,
            encryption_algorithm: request.encryption_algorithm.as_deref(),
            message_timestamp,
            reply_to: request.reply_to.as_deref(),
        })
        .await
    {
        Ok(_) => {
            log::info!("Stored DM from {:?} to {:?}", sender, request.recipient);

            // TODO: Notify WebSocket connections for the recipient
            // This would be handled by the WebSocket manager

            let response = SendDMResponse {
                success: true,
                error: None,
                message_id: Some(request.message_id),
            };
            Ok(Json(response))
        }
        Err(e) => {
            log::error!("Failed to store message: {}", e);
            let response = SendDMResponse {
                success: false,
                error: Some("Failed to store message".to_string()),
                message_id: None,
            };
            Ok(Json(response))
        }
    }
}

/// Get DM history with another user
pub async fn get_dm_history(
    requester: PolycentricIdentity,
    State(state): State<AppState>,
    Json(request): Json<GetDMHistoryRequest>,
) -> Result<Json<GetDMHistoryResponse>, AuthError> {
    let limit = request.limit.unwrap_or(50).min(100); // Max 100 messages

    match state
        .db
        .get_dm_history(
            &requester,
            &request.other_party,
            request.cursor.as_deref(),
            limit,
        )
        .await
    {
        Ok(messages) => {
            let has_more = messages.len() >= limit as usize;
            let next_cursor = if has_more {
                messages.last().map(|msg| msg.created_at.to_rfc3339())
            } else {
                None
            };

            let messages: Vec<DMMessageResponse> =
                messages.into_iter().map(|msg| msg.into()).collect();

            let response = GetDMHistoryResponse {
                messages,
                next_cursor,
                has_more,
            };

            Ok(Json(response))
        }
        Err(e) => {
            log::error!("Failed to get DM history: {}", e);
            let error_response = GetDMHistoryResponse {
                messages: vec![],
                next_cursor: None,
                has_more: false,
            };
            Ok(Json(error_response))
        }
    }
}

/// Mark messages as read
pub async fn mark_messages_read(
    _requester: PolycentricIdentity,
    State(state): State<AppState>,
    Json(message_ids): Json<Vec<String>>,
) -> Result<Json<serde_json::Value>, AuthError> {
    let read_timestamp = Utc::now();
    let mut success_count = 0;

    for message_id in message_ids {
        match state
            .db
            .mark_message_read(&message_id, read_timestamp)
            .await
        {
            Ok(()) => success_count += 1,
            Err(e) => {
                log::warn!("Failed to mark message {} as read: {}", message_id, e);
            }
        }
    }

    let response = serde_json::json!({
        "success": true,
        "marked_count": success_count
    });

    Ok(Json(response))
}
