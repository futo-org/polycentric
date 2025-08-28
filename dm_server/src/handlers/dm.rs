use axum::{extract::State, Json};
use chrono::Utc;

use super::{auth::AuthError, AppState};
use crate::crypto::DMCrypto;
use crate::models::*;

/// Send a direct message
pub async fn send_dm(
    sender: PolycentricIdentity,
    State(state): State<AppState>,
    Json(request): Json<SendDMRequest>,
) -> Result<Json<SendDMResponse>, AuthError> {
    // Validate message size
    if request.encrypted_content.len() > state.config.max_message_size {
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

    // Verify signature - sender must sign the message data (excluding timestamp to avoid timing issues)
    let message_data = serde_json::to_vec(&serde_json::json!({
        "message_id": request.message_id,
        "sender": {
            "key_type": sender.key_type,
            "key_bytes": sender.key_bytes,
        },
        "recipient": {
            "key_type": request.recipient.key_type,
            "key_bytes": request.recipient.key_bytes,
        },
        "ephemeral_public_key": request.ephemeral_public_key,
        "encrypted_content": request.encrypted_content,
        "nonce": request.nonce,
    }))
    .map_err(|e| {
        log::error!("Failed to serialize message for verification: {}", e);
        AuthError::InternalError
    })?;

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
        .store_message(
            &request.message_id,
            &sender,
            &request.recipient,
            &request.ephemeral_public_key,
            &request.encrypted_content,
            &request.nonce,
            message_timestamp,
            request.reply_to.as_deref(),
        )
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
