use anyhow::{anyhow, Result};
use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts, State},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Json, Response},
};
use hmac_sha256::HMAC;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use super::AppState;
use crate::crypto::DMCrypto;
use crate::models::PolycentricIdentity;

/// Challenge response structure similar to Harbor
#[derive(Debug, Serialize, Deserialize)]
pub struct ChallengeResponse {
    pub body: Vec<u8>,
    pub hmac: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChallengeBody {
    pub challenge: Vec<u8>,
    pub created_on: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthRequest {
    pub challenge_response: ChallengeResponse,
    pub identity: PolycentricIdentity,
    pub signature: Vec<u8>,
}

/// Generate a challenge for authentication
pub async fn get_challenge(
    State(state): State<AppState>,
) -> Result<Json<ChallengeResponse>, AuthError> {
    let challenge = DMCrypto::generate_challenge();
    let created_on = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let body = ChallengeBody {
        challenge: challenge.to_vec(),
        created_on,
    };

    let body_bytes = serde_json::to_vec(&body).map_err(|e| {
        log::error!("Failed to serialize challenge body: {}", e);
        AuthError::InternalError
    })?;

    let hmac = HMAC::mac(body_bytes.clone(), state.config.challenge_key.as_bytes()).to_vec();

    let response = ChallengeResponse {
        body: body_bytes,
        hmac,
    };

    Ok(Json(response))
}

/// Verify authentication with challenge-response
pub fn verify_auth(auth_request: &AuthRequest, challenge_key: &str) -> Result<()> {
    // Verify HMAC
    let expected_hmac = HMAC::mac(
        auth_request.challenge_response.body.clone(),
        challenge_key.as_bytes(),
    )
    .to_vec();

    if !constant_time_eq::constant_time_eq(&expected_hmac, &auth_request.challenge_response.hmac) {
        return Err(anyhow!("Invalid HMAC"));
    }

    // Parse challenge body
    let challenge_body: ChallengeBody =
        serde_json::from_slice(&auth_request.challenge_response.body)
            .map_err(|e| anyhow!("Invalid challenge body: {}", e))?;

    // Check challenge age (max 5 minutes)
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    if now - challenge_body.created_on > 300_000 {
        return Err(anyhow!("Challenge expired"));
    }

    // Verify signature
    let verifying_key = auth_request
        .identity
        .verifying_key()
        .map_err(|e| anyhow!("Invalid identity key: {}", e))?;

    DMCrypto::verify_signature(
        &verifying_key,
        &challenge_body.challenge,
        &auth_request.signature,
    )
    .map_err(|e| anyhow!("Signature verification failed: {}", e))?;

    Ok(())
}

/// Extract and verify identity from Authorization header
pub fn extract_auth_identity(
    auth_header: &str,
    challenge_key: &str,
) -> Result<PolycentricIdentity> {
    // Auth header format: "Bearer <base64-encoded-auth-request>"
    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| anyhow!("Invalid authorization header format"))?;

    let auth_bytes =
        base64::decode(token).map_err(|e| anyhow!("Invalid base64 encoding: {}", e))?;

    let auth_request: AuthRequest =
        serde_json::from_slice(&auth_bytes).map_err(|e| anyhow!("Invalid auth request: {}", e))?;

    verify_auth(&auth_request, challenge_key)?;

    Ok(auth_request.identity)
}

/// Axum extractor for authenticated identity
#[async_trait]
impl<S> FromRequestParts<S> for PolycentricIdentity
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);

        let auth_header = parts
            .headers
            .get("authorization")
            .and_then(|header| header.to_str().ok())
            .ok_or(AuthError::Unauthorized)?;

        match extract_auth_identity(auth_header, &app_state.config.challenge_key) {
            Ok(identity) => Ok(identity),
            Err(e) => {
                log::warn!("Authentication failed: {}", e);
                Err(AuthError::Unauthorized)
            }
        }
    }
}

/// Custom error types for Axum
#[derive(Debug)]
pub enum AuthError {
    Unauthorized,
    InternalError,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized"),
            AuthError::InternalError => {
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
            }
        };

        (status, message).into_response()
    }
}
