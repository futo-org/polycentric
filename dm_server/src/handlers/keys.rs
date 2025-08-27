use warp::Reply;

use crate::crypto::DMCrypto;
use crate::models::*;
use super::{AppState, auth::AuthError};

/// Register a user's X25519 public key for DM encryption
pub async fn register_x25519_key(
    identity: PolycentricIdentity,
    request: RegisterX25519KeyRequest,
    state: AppState,
) -> Result<impl Reply, warp::Rejection> {
    // Verify the signature of the X25519 key
    let verifying_key = identity.verifying_key()
        .map_err(|e| {
            log::error!("Invalid identity key: {}", e);
            warp::reject::custom(AuthError)
        })?;

    if let Err(e) = DMCrypto::verify_signature(
        &verifying_key,
        &request.x25519_public_key,
        &request.signature,
    ) {
        log::warn!("X25519 key signature verification failed: {}", e);
        return Err(warp::reject::custom(AuthError));
    }

    // Validate X25519 key length
    if request.x25519_public_key.len() != 32 {
        let response = RegisterX25519KeyResponse {
            success: false,
            error: Some("Invalid X25519 key length".to_string()),
        };
        return Ok(warp::reply::json(&response));
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
            Ok(warp::reply::json(&response))
        }
        Err(e) => {
            log::error!("Failed to register X25519 key: {}", e);
            let response = RegisterX25519KeyResponse {
                success: false,
                error: Some("Database error".to_string()),
            };
            Ok(warp::reply::json(&response))
        }
    }
}

/// Get a user's X25519 public key
pub async fn get_x25519_key(
    target_identity: GetX25519KeyRequest,
    state: AppState,
) -> Result<impl Reply, warp::Rejection> {
    match state.db.get_x25519_key(&target_identity.identity).await {
        Ok(Some(key_data)) => {
            let response = GetX25519KeyResponse {
                found: true,
                x25519_public_key: Some(key_data.x25519_public_key),
                timestamp: Some(key_data.created_at),
            };
            Ok(warp::reply::json(&response))
        }
        Ok(None) => {
            let response = GetX25519KeyResponse {
                found: false,
                x25519_public_key: None,
                timestamp: None,
            };
            Ok(warp::reply::json(&response))
        }
        Err(e) => {
            log::error!("Failed to get X25519 key: {}", e);
            let response = GetX25519KeyResponse {
                found: false,
                x25519_public_key: None,
                timestamp: None,
            };
            Ok(warp::reply::json(&response))
        }
    }
}

/// Get conversation list for the authenticated user
pub async fn get_conversations(
    identity: PolycentricIdentity,
    limit: Option<u32>,
    state: AppState,
) -> Result<impl Reply, warp::Rejection> {
    let limit = limit.unwrap_or(50).min(100); // Max 100 conversations

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

            Ok(warp::reply::json(&conversations))
        }
        Err(e) => {
            log::error!("Failed to get conversation list: {}", e);
            let empty_response: Vec<serde_json::Value> = vec![];
            Ok(warp::reply::json(&empty_response))
        }
    }
}
