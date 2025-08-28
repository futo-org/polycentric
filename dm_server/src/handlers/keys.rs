use axum::{
    extract::{Query, State},
    Json,
};
use std::collections::HashMap;

use crate::crypto::DMCrypto;
use crate::models::*;
use super::{AppState, auth::AuthError};

/// Register a user's X25519 public key for DM encryption
pub async fn register_x25519_key(
    identity: PolycentricIdentity,
    State(state): State<AppState>,
    Json(request): Json<RegisterX25519KeyRequest>,
) -> Result<Json<RegisterX25519KeyResponse>, AuthError> {
    // Verify the signature of the X25519 key
    let verifying_key = identity.verifying_key()
        .map_err(|e| {
            log::error!("Invalid identity key: {}", e);
            AuthError::InternalError
        })?;

    if let Err(e) = DMCrypto::verify_signature(
        &verifying_key,
        &request.x25519_public_key,
        &request.signature,
    ) {
        log::warn!("X25519 key signature verification failed: {}", e);
        return Err(AuthError::Unauthorized);
    }

    // Validate X25519 key length
    if request.x25519_public_key.len() != 32 {
        let response = RegisterX25519KeyResponse {
            success: false,
            error: Some("Invalid X25519 key length".to_string()),
        };
        return Ok(Json(response));
    }

    // Store the key in database
    match state.db.register_x25519_key(
        &identity,
        &request.x25519_public_key,
        &request.signature,
    ).await {
        Ok(()) => {
            log::info!("Registered X25519 key for identity: {:?}", identity);
            let response = RegisterX25519KeyResponse {
                success: true,
                error: None,
            };
            Ok(Json(response))
        }
        Err(e) => {
            log::error!("Failed to register X25519 key: {}", e);
            let response = RegisterX25519KeyResponse {
                success: false,
                error: Some("Database error".to_string()),
            };
            Ok(Json(response))
        }
    }
}

/// Get a user's X25519 public key
pub async fn get_x25519_key(
    State(state): State<AppState>,
    Json(target_identity): Json<GetX25519KeyRequest>,
) -> Result<Json<GetX25519KeyResponse>, AuthError> {
    match state.db.get_x25519_key(&target_identity.identity).await {
        Ok(Some(key_data)) => {
            let response = GetX25519KeyResponse {
                found: true,
                x25519_public_key: Some(key_data.x25519_public_key),
                timestamp: Some(key_data.created_at),
            };
            Ok(Json(response))
        }
        Ok(None) => {
            let response = GetX25519KeyResponse {
                found: false,
                x25519_public_key: None,
                timestamp: None,
            };
            Ok(Json(response))
        }
        Err(e) => {
            log::error!("Failed to get X25519 key: {}", e);
            let response = GetX25519KeyResponse {
                found: false,
                x25519_public_key: None,
                timestamp: None,
            };
            Ok(Json(response))
        }
    }
}

/// Get conversation list for the authenticated user
pub async fn get_conversations(
    identity: PolycentricIdentity,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Result<Json<Vec<serde_json::Value>>, AuthError> {
    let limit = params.get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(50)
        .min(100); // Max 100 conversations

    match state.db.get_conversation_list(&identity, limit).await {
        Ok(conversations) => {
            let conversations: Vec<_> = conversations
                .into_iter()
                .map(|(other_identity, last_message_at)| {
                    serde_json::json!({
                        "identity": other_identity,
                        "last_message_at": last_message_at
                    })
                })
                .collect();

            Ok(Json(conversations))
        }
        Err(e) => {
            log::error!("Failed to get conversation list: {}", e);
            let empty_response: Vec<serde_json::Value> = vec![];
            Ok(Json(empty_response))
        }
    }
}
