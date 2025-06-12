use axum::{
    async_trait,
    extract::{FromRequestParts, State, FromRef},
    http::{header, request::Parts, StatusCode},
    response::{IntoResponse, Response, Json},
    RequestPartsExt,
};
use axum_extra::{
    extract::TypedHeader,
    headers::{
        HeaderMap, HeaderValue, authorization::{Authorization, Bearer},
    },
};
use base64;
use ed25519_dalek::{Signature, VerifyingKey, Verifier};
use rand::{thread_rng, RngCore};
use dashmap::DashMap;
use serde::{Serialize, Deserialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use thiserror::Error;
use uuid::Uuid;
use crate::AppState;
use axum::http::HeaderName;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashSet;

// --- Challenge Nonce Storage ---

const CHALLENGE_TTL: Duration = Duration::from_secs(60 * 5); // 5 minutes TTL for a challenge
const NONCE_LENGTH: usize = 32; // 32 bytes for nonce

// TODO: add a challenge store that can be shared between instances of the server for HA.

#[derive(Debug, Clone)]
struct ChallengeNonce {
    nonce: Vec<u8>,
    expires_at: Instant,
}

// Using DashMap for concurrent access
#[derive(Debug, Clone)]
pub struct ChallengeStore {
    challenges: Arc<DashMap<Uuid, ChallengeNonce>>,
}

impl ChallengeStore {
    pub fn new() -> Self {
        let store = Self {
            challenges: Arc::new(DashMap::new()),
        };
        // Start a background task to purge expired challenges periodically
        let store_clone = store.clone();
        tokio::spawn(async move {
            store_clone.purge_expired_periodically().await;
        });
        store
    }

    /// Generates a new challenge, stores it, and returns the ID and nonce.
    pub fn generate(&self) -> (Uuid, Vec<u8>) {
        let challenge_id = Uuid::new_v4();
        let mut nonce = vec![0u8; NONCE_LENGTH];
        thread_rng().fill_bytes(&mut nonce);

        let challenge = ChallengeNonce {
            nonce: nonce.clone(),
            expires_at: Instant::now() + CHALLENGE_TTL,
        };

        self.challenges.insert(challenge_id, challenge);
        
        (challenge_id, nonce)
    }

    /// Attempts to retrieve and consume a challenge nonce.
    /// Returns the nonce if valid and not expired, otherwise None.
    pub fn use_challenge(&self, challenge_id: Uuid) -> Option<Vec<u8>> {
        // `remove_if` atomically removes and returns the item if the condition is met
        self.challenges
            .remove_if(&challenge_id, |_, challenge| {
                challenge.expires_at > Instant::now()
            })
            .map(|(_id, challenge)| challenge.nonce) // Return nonce if removed
    }
    
    /// Removes expired challenges from the store.
    fn purge_expired(&self) {
        self.challenges.retain(|_, challenge| challenge.expires_at > Instant::now());
        // println!("Purged expired challenges. Remaining: {}", self.challenges.len()); // Optional: for debugging
    }

    /// Background task to periodically purge expired challenges.
    async fn purge_expired_periodically(&self) {
        let mut interval = tokio::time::interval(CHALLENGE_TTL); // Check every CHALLENGE_TTL duration
        loop {
            interval.tick().await;
            self.purge_expired();
        }
    }
}

// Default implementation for easy setup in AppState
impl Default for ChallengeStore {
    fn default() -> Self {
        Self::new()
    }
}

// --- Auth Endpoints ---

#[derive(Serialize, Deserialize, Debug)]
pub struct ChallengeResponse {
    pub challenge_id: Uuid,
    pub nonce_base64: String,
}

/// Handler to generate and return a new authentication challenge.
pub async fn get_challenge_handler(State(state): State<AppState>) -> Json<ChallengeResponse> {
    let (id, nonce) = state.challenge_store.generate();
    Json(ChallengeResponse {
        challenge_id: id,
        nonce_base64: base64::encode(&nonce),
    })
}

// --- Error Types ---

#[derive(Debug, Error, Clone)]
pub enum AuthError {
    #[error("Missing or invalid authentication header(s)")]
    MissingOrInvalidHeaders,

    #[error("Invalid Base64 encoding")]
    InvalidBase64(#[from] base64::DecodeError),

    #[error("Invalid public key format")]
    InvalidPublicKey,

    #[error("Invalid signature format")]
    InvalidSignature,

    #[error("Invalid challenge ID or challenge expired")]
    InvalidOrExpiredChallenge,

    #[error("Signature verification failed")]
    VerificationFailed,
    
    #[error("Internal server error during authentication")]
    InternalError, // Catch-all for unexpected issues
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            AuthError::MissingOrInvalidHeaders => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::InvalidBase64(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AuthError::InvalidPublicKey => (StatusCode::BAD_REQUEST, self.to_string()),
            AuthError::InvalidSignature => (StatusCode::BAD_REQUEST, self.to_string()),
            AuthError::InvalidOrExpiredChallenge => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::VerificationFailed => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::InternalError => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };
        (status, error_message).into_response()
    }
}

// --- Authenticated User Extractor ---

// This struct will be extracted if authentication is successful.
// It holds the verified public key bytes.
#[derive(Debug, Clone)]
pub struct AuthenticatedUser(pub Vec<u8>);

// --- Constants for Headers ---
const HEADER_PUBKEY: &str = "X-Polycentric-Pubkey-Base64";
const HEADER_SIGNATURE: &str = "X-Polycentric-Signature-Base64";
const HEADER_CHALLENGE_ID: &str = "X-Polycentric-Challenge-ID";

#[async_trait]
impl<S> FromRequestParts<S> for AuthenticatedUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        // Check if already processed
        if let Some(cached_result) = parts.extensions.get::<Result<Self, Self::Rejection>>() {
            tracing::debug!("[Auth Extractor] Using cached AuthenticatedUser result.");
            return cached_result.clone();
        }

        tracing::debug!("[Auth Extractor] Attempting authentication (fresh)...");
        tracing::debug!("[Auth Extractor] Received Headers: {:#?}", parts.headers);

        let app_state = AppState::from_ref(state);
        let challenge_store = &app_state.challenge_store;

        let result = async {
            // 1. Extract headers
            let pubkey_b64 = parts.headers.get(HEADER_PUBKEY)
                .ok_or(AuthError::MissingOrInvalidHeaders)?
                .to_str().map_err(|_| AuthError::MissingOrInvalidHeaders)?;

            let signature_b64 = parts.headers.get(HEADER_SIGNATURE)
                .ok_or(AuthError::MissingOrInvalidHeaders)?
                .to_str().map_err(|_| AuthError::MissingOrInvalidHeaders)?;

            let challenge_id_str = parts.headers.get(HEADER_CHALLENGE_ID)
                .ok_or(AuthError::MissingOrInvalidHeaders)?
                .to_str().map_err(|_| AuthError::MissingOrInvalidHeaders)?;

            // 2. Decode Base64
            let pubkey_bytes = base64::decode(pubkey_b64).map_err(AuthError::InvalidBase64)?;
            let signature_bytes = base64::decode(signature_b64).map_err(AuthError::InvalidBase64)?;

            // 3. Parse Challenge ID
            let challenge_id_uuid = Uuid::parse_str(challenge_id_str)
                .map_err(|_| AuthError::InvalidOrExpiredChallenge)?; // If malformed, treat as invalid

            // 4. Validate Public Key
            let pubkey_array: &[u8; 32] = pubkey_bytes.as_slice().try_into()
                .map_err(|_| AuthError::InvalidPublicKey)?;
            let verifying_key = VerifyingKey::from_bytes(pubkey_array)
                .map_err(|_| AuthError::InvalidPublicKey)?;

            // 5. Validate Signature format (length)
            let signature_array: &[u8; 64] = signature_bytes.as_slice().try_into()
                .map_err(|_| AuthError::InvalidSignature)?;
            let signature = Signature::from_bytes(signature_array);

            // 6. Use Challenge (Critical: This consumes the challenge)
            let nonce = challenge_store.use_challenge(challenge_id_uuid)
                .ok_or(AuthError::InvalidOrExpiredChallenge)?;

            // 7. Verify Signature
            verifying_key.verify(&nonce, &signature)
                .map_err(|_| AuthError::VerificationFailed)?;

            Ok(AuthenticatedUser(pubkey_bytes))
        }.await;

        // Cache the result before returning
        parts.extensions.insert(result.clone());
        tracing::debug!("[Auth Extractor] Cached result: {:?}", result.is_ok());
        result
    }
}

// --- Admin User Extractor ---

// Wrapper struct to signify an admin user
#[derive(Debug, Clone)]
pub struct AdminUser(pub AuthenticatedUser);

#[async_trait]
impl<S> FromRequestParts<S> for AdminUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    // Use AuthError for rejection, same as AuthenticatedUser
    type Rejection = AuthError; 

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        // 1. Perform standard authentication
        let authenticated_user = AuthenticatedUser::from_request_parts(parts, state).await?;

        // 2. Get AppState to access admin keys
        let app_state = AppState::from_ref(state);
        let admin_keys = &app_state.admin_pubkeys;

        // 3. Check if the authenticated user's key is in the admin set
        if admin_keys.contains(&authenticated_user.0) {
            // If yes, wrap the AuthenticatedUser in AdminUser and return Ok
            Ok(AdminUser(authenticated_user))
        } else {
            // If no, return a Forbidden error (using AuthError for consistency)
            // We might want a more specific variant later, but this works.
            // Consider adding a `Forbidden` variant to AuthError if needed.
            eprintln!("Admin access denied for pubkey: {}", base64::encode(&authenticated_user.0)); 
            Err(AuthError::VerificationFailed) // Reusing VerificationFailed might be okay, or add Forbidden
        }
    }
}

// --- Check Admin Handler ---

#[derive(Serialize)] // Make sure Serialize is imported (use serde::Serialize;)
pub struct CheckAdminResponse {
    #[serde(rename = "isAdmin")]
    is_admin: bool,
}

/// Checks if the currently authenticated user is an admin.
pub async fn check_admin_handler(
    State(state): State<AppState>, // Make sure State is imported (use axum::extract::State;)
    user: AuthenticatedUser, // Requires standard authentication
) -> Json<CheckAdminResponse> { // Make sure Json is imported (use axum::response::Json;)
    let is_admin = state.admin_pubkeys.contains(&user.0);
    Json(CheckAdminResponse { is_admin })
}

// --- Tests for Authenticator ---
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;
    use axum::http::Request;
    use axum::body::Body;
    use sqlx::{Pool, Postgres};

    fn generate_keypair() -> SigningKey {
        let mut csprng = OsRng{};
        SigningKey::generate(&mut csprng)
    }

    async fn setup_test_state() -> AppState {
        let pool_options = sqlx::postgres::PgPoolOptions::new().max_connections(1);
         let test_db_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://test_user:test_password@localhost/test_db_auth".to_string());
        let pool = pool_options.connect_lazy(&test_db_url).expect("Failed to create lazy pool");
        
        // Create an empty set of admin keys for tests by default
        let admin_pubkeys = Arc::new(HashSet::<Vec<u8>>::new()); 

        AppState {
            db_pool: pool,
            image_storage: crate::storage::LocalImageStorage::new(".".into(), "/images".into()),
            challenge_store: ChallengeStore::new(),
            admin_pubkeys, // Initialize the new field
        }
    }

    #[tokio::test]
    async fn test_auth_extractor_success() {
        let app_state = setup_test_state().await;
        let challenge_store = &app_state.challenge_store;
        let keypair = generate_keypair();
        let public_key = keypair.verifying_key();
        let public_key_bytes = public_key.to_bytes().to_vec();

        let (challenge_id, nonce) = challenge_store.generate();

        let signature = keypair.sign(&nonce);

        let mut parts = Request::builder()
            .header(HEADER_PUBKEY, base64::encode(&public_key_bytes))
            .header(HEADER_SIGNATURE, base64::encode(signature.to_bytes()))
            .header(HEADER_CHALLENGE_ID, challenge_id.to_string())
            .body(Body::empty()).unwrap().into_parts().0;

        let result = AuthenticatedUser::from_request_parts(&mut parts, &app_state).await;

        assert!(result.is_ok());
        let authenticated_user = result.unwrap();
        assert_eq!(authenticated_user.0, public_key_bytes);

        assert!(app_state.challenge_store.use_challenge(challenge_id).is_none());
    }

    #[tokio::test]
    async fn test_auth_extractor_missing_header() {
        let app_state = setup_test_state().await;
        let keypair = generate_keypair();
        let (challenge_id, nonce) = app_state.challenge_store.generate();
        let signature = keypair.sign(&nonce);

        let mut parts = Request::builder()
            .header(HEADER_SIGNATURE, base64::encode(signature.to_bytes()))
            .header(HEADER_CHALLENGE_ID, challenge_id.to_string())
            .body(Body::empty()).unwrap().into_parts().0;

        let result = AuthenticatedUser::from_request_parts(&mut parts, &app_state).await;
        assert!(matches!(result, Err(AuthError::MissingOrInvalidHeaders)));
    }

     #[tokio::test]
    async fn test_auth_extractor_invalid_base64() {
        let app_state = setup_test_state().await;
        let keypair = generate_keypair();
        let (challenge_id, nonce) = app_state.challenge_store.generate();
        let signature = keypair.sign(&nonce);

        let mut parts = Request::builder()
            .header(HEADER_PUBKEY, "invalid-base64!")
            .header(HEADER_SIGNATURE, base64::encode(signature.to_bytes()))
            .header(HEADER_CHALLENGE_ID, challenge_id.to_string())
            .body(Body::empty()).unwrap().into_parts().0;

        let result = AuthenticatedUser::from_request_parts(&mut parts, &app_state).await;
        match result {
            Err(AuthError::InvalidBase64(_)) => {}
            _ => panic!("Expected InvalidBase64 error"),
        }
    }

    #[tokio::test]
    async fn test_auth_extractor_invalid_pubkey() {
        let app_state = setup_test_state().await;
        let keypair = generate_keypair();
        let (challenge_id, nonce) = app_state.challenge_store.generate();
        let signature = keypair.sign(&nonce);
        let invalid_pubkey_bytes = vec![1, 2, 3];

        let mut parts = Request::builder()
            .header(HEADER_PUBKEY, base64::encode(&invalid_pubkey_bytes))
            .header(HEADER_SIGNATURE, base64::encode(signature.to_bytes()))
            .header(HEADER_CHALLENGE_ID, challenge_id.to_string())
            .body(Body::empty()).unwrap().into_parts().0;

        let result = AuthenticatedUser::from_request_parts(&mut parts, &app_state).await;
        assert!(matches!(result, Err(AuthError::InvalidPublicKey)));
    }

     #[tokio::test]
    async fn test_auth_extractor_invalid_signature_format() {
        let app_state = setup_test_state().await;
        let keypair = generate_keypair();
        let public_key = keypair.verifying_key();
        let (challenge_id, _nonce) = app_state.challenge_store.generate();
        let invalid_signature_bytes = vec![4, 5, 6];

        let mut parts = Request::builder()
            .header(HEADER_PUBKEY, base64::encode(public_key.to_bytes()))
            .header(HEADER_SIGNATURE, base64::encode(&invalid_signature_bytes))
            .header(HEADER_CHALLENGE_ID, challenge_id.to_string())
            .body(Body::empty()).unwrap().into_parts().0;

        let result = AuthenticatedUser::from_request_parts(&mut parts, &app_state).await;
        assert!(matches!(result, Err(AuthError::InvalidSignature)));
    }

    #[tokio::test]
    async fn test_auth_extractor_invalid_challenge_id() {
        let app_state = setup_test_state().await;
        let keypair = generate_keypair();
        let public_key = keypair.verifying_key();
        let (challenge_id, nonce) = app_state.challenge_store.generate();
        let signature = keypair.sign(&nonce);
        let wrong_challenge_id = Uuid::new_v4();

        let mut parts = Request::builder()
            .header(HEADER_PUBKEY, base64::encode(public_key.to_bytes()))
            .header(HEADER_SIGNATURE, base64::encode(signature.to_bytes()))
            .header(HEADER_CHALLENGE_ID, wrong_challenge_id.to_string())
            .body(Body::empty()).unwrap().into_parts().0;

        let result = AuthenticatedUser::from_request_parts(&mut parts, &app_state).await;
        assert!(matches!(result, Err(AuthError::InvalidOrExpiredChallenge)));
    }

     #[tokio::test]
    async fn test_auth_extractor_expired_challenge() {
        let app_state = setup_test_state().await;
        let keypair = generate_keypair();
        let public_key = keypair.verifying_key();
        let (challenge_id, nonce) = app_state.challenge_store.generate();
        let signature = keypair.sign(&nonce);

        assert!(app_state.challenge_store.use_challenge(challenge_id).is_some());

        let mut parts = Request::builder()
            .header(HEADER_PUBKEY, base64::encode(public_key.to_bytes()))
            .header(HEADER_SIGNATURE, base64::encode(signature.to_bytes()))
            .header(HEADER_CHALLENGE_ID, challenge_id.to_string())
            .body(Body::empty()).unwrap().into_parts().0;

        let result = AuthenticatedUser::from_request_parts(&mut parts, &app_state).await;
        assert!(matches!(result, Err(AuthError::InvalidOrExpiredChallenge)));
    }


    #[tokio::test]
    async fn test_auth_extractor_verification_failed() {
        let app_state = setup_test_state().await;
        let keypair = generate_keypair();
        let public_key = keypair.verifying_key();
        let (challenge_id, nonce) = app_state.challenge_store.generate();

        let other_data = b"some other data";
        let wrong_signature = keypair.sign(other_data);

        let mut parts = Request::builder()
            .header(HEADER_PUBKEY, base64::encode(public_key.to_bytes()))
            .header(HEADER_SIGNATURE, base64::encode(wrong_signature.to_bytes()))
            .header(HEADER_CHALLENGE_ID, challenge_id.to_string())
            .body(Body::empty()).unwrap().into_parts().0;

        let result = AuthenticatedUser::from_request_parts(&mut parts, &app_state).await;
        assert!(matches!(result, Err(AuthError::VerificationFailed)));
    }
} 