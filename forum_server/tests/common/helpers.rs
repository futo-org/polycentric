// tests/common/helpers.rs
//! Shared helper functions for integration tests

use axum::http::{
    header::{HeaderName, HeaderValue},
    HeaderMap,
};
use axum::{
    body::Body,
    http::{self, Request, StatusCode},
    response::Response,
    Router,
};
use base64;
use ed25519_dalek::{Signer, SigningKey};
use forum_server::auth::ChallengeResponse;
use forum_server::AppState;
use forum_server::{
    create_router,
    models::{Board, Category, Post, Thread},
};
use http_body_util::BodyExt;
use rand::rngs::OsRng;
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashSet;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

// Function to generate a random boundary string
pub fn generate_boundary() -> String {
    format!("----WebKitFormBoundary{}", Uuid::new_v4().simple())
}

// Updated to accept optional admin keys for specific test setup
pub async fn create_test_app(pool: PgPool, admin_keys: Option<Vec<Vec<u8>>>) -> Router {
    // Provide dummy values for image storage config during testing
    let test_upload_dir = "./test_uploads".to_string();
    let test_base_url = "/test_images".to_string();

    // Create admin key set from provided keys or empty if None
    let admin_pubkeys_set: HashSet<Vec<u8>> = admin_keys.unwrap_or_default().into_iter().collect();
    let admin_pubkeys_arc = Arc::new(admin_pubkeys_set);

    // Provide simple server config for tests
    let config = forum_server::config::ForumServerConfig::new("Test Forum".to_string(), None);

    create_router(
        pool,
        test_upload_dir,
        test_base_url,
        admin_pubkeys_arc,
        false, // image uploads disabled in tests by default
        config,
    )
}

// Updated helper to require admin keypair for auth
pub async fn create_test_category(app: &Router, name: &str, admin_keypair: &SigningKey) -> Uuid {
    let auth_headers = get_auth_headers(app, admin_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/categories")
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                // Add admin auth headers
                .header(
                    HeaderName::from_static("x-polycentric-pubkey-base64"),
                    auth_headers.get("x-polycentric-pubkey-base64").unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-signature-base64"),
                    auth_headers.get("x-polycentric-signature-base64").unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-challenge-id"),
                    auth_headers.get("x-polycentric-challenge-id").unwrap(),
                )
                .body(Body::from(
                    json!({ "name": name, "description": "..." }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        status,
        StatusCode::CREATED,
        "Failed to create category: {}",
        String::from_utf8_lossy(&body)
    );
    let category: Category =
        serde_json::from_slice(&body).expect("Failed to deserialize category in helper");
    category.id
}

// NOTE: Removed description from signature to match usage in post_api.rs
// Updated to require admin keypair for auth
pub async fn create_test_board(
    app: &Router,
    category_id: Uuid,
    name: &str,
    admin_keypair: &SigningKey,
) -> Uuid {
    let auth_headers = get_auth_headers(app, admin_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                // Add admin auth headers
                .header(
                    HeaderName::from_static("x-polycentric-pubkey-base64"),
                    auth_headers.get("x-polycentric-pubkey-base64").unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-signature-base64"),
                    auth_headers.get("x-polycentric-signature-base64").unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-challenge-id"),
                    auth_headers.get("x-polycentric-challenge-id").unwrap(),
                )
                .body(Body::from(
                    json!({ "name": name, "description": "..." }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        status,
        StatusCode::CREATED,
        "Failed to create board: {}",
        String::from_utf8_lossy(&body)
    );
    let board: Board =
        serde_json::from_slice(&body).expect("Failed to deserialize board in helper");
    board.id
}

// Helper to generate a test keypair
pub fn generate_test_keypair() -> SigningKey {
    let mut csprng = OsRng {};
    SigningKey::generate(&mut csprng)
}

// Helper to get challenge and prepare auth headers
pub async fn get_auth_headers(app: &Router, keypair: &SigningKey) -> HeaderMap {
    // 1. Get challenge
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/auth/challenge")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "Failed to get challenge");
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let challenge_resp: ChallengeResponse =
        serde_json::from_slice(&body).expect("Failed to deserialize challenge response in helper");

    // 2. Decode nonce
    let nonce =
        base64::decode(&challenge_resp.nonce_base64).expect("Failed to decode nonce in helper");

    // 3. Sign nonce
    let signature = keypair.sign(&nonce);

    // 4. Prepare headers
    let mut headers = HeaderMap::new();
    let pubkey_bytes = keypair.verifying_key().to_bytes().to_vec();
    headers.insert(
        HeaderName::from_static("x-polycentric-pubkey-base64"),
        HeaderValue::from_str(&base64::encode(&pubkey_bytes)).unwrap(),
    );
    headers.insert(
        HeaderName::from_static("x-polycentric-signature-base64"),
        HeaderValue::from_str(&base64::encode(signature.to_bytes())).unwrap(),
    );
    headers.insert(
        HeaderName::from_static("x-polycentric-challenge-id"),
        HeaderValue::from_str(&challenge_resp.challenge_id.to_string()).unwrap(),
    );

    headers
}

// Modify create_test_thread - takes Keypair, adds auth headers, sends multipart
pub async fn create_test_thread(
    app: &Router,
    board_id: Uuid,
    title: &str,
    content: &str,
    keypair: &SigningKey,
) -> (Uuid, Uuid) {
    let auth_headers = get_auth_headers(app, keypair).await;

    let boundary = generate_boundary();
    let mut body = Vec::new();

    // Add title field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"title\"\r\n\r\n");
    body.extend_from_slice(title.as_bytes());
    body.extend_from_slice(b"\r\n");

    // Add content field (for the initial post)
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body.extend_from_slice(content.as_bytes());
    body.extend_from_slice(b"\r\n");

    // Add closing boundary
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    let request = Request::builder()
        .method(http::Method::POST)
        .uri(format!("/boards/{}/threads", board_id))
        .header(
            http::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        // Add auth headers
        .header(
            HeaderName::from_static("x-polycentric-pubkey-base64"),
            auth_headers.get("x-polycentric-pubkey-base64").unwrap(),
        )
        .header(
            HeaderName::from_static("x-polycentric-signature-base64"),
            auth_headers.get("x-polycentric-signature-base64").unwrap(),
        )
        .header(
            HeaderName::from_static("x-polycentric-challenge-id"),
            auth_headers.get("x-polycentric-challenge-id").unwrap(),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();

    let status = response.status();
    let response_body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        status,
        StatusCode::CREATED,
        "Failed to create thread in helper: {}",
        String::from_utf8_lossy(&response_body)
    );

    // Deserialize into CreatedThreadInfo to get the thread ID and initial post ID
    let created_info: forum_server::repositories::thread_repository::CreatedThreadInfo =
        serde_json::from_slice(&response_body)
            .expect("Failed to deserialize CreatedThreadInfo in helper");

    (created_info.thread.id, created_info.initial_post_id)
}

// Modify create_test_post - takes Keypair, adds auth headers
pub async fn create_test_post(
    app: &Router,
    thread_id: Uuid,
    content: &str,
    keypair: &SigningKey,         // Changed from author: &str
    _images: Option<Vec<String>>, // Renamed unused param
) -> (StatusCode, Vec<u8>, Vec<u8>) {
    // Return status, body, and pubkey used
    let auth_headers = get_auth_headers(app, keypair).await;
    let pubkey_bytes = keypair.verifying_key().to_bytes().to_vec(); // Get expected key bytes

    // --- Debugging Print ---
    println!("--- create_test_post Helper ---");
    println!("Creating post in thread: {}", thread_id);
    println!("Using PubKey (b64): {}", base64::encode(&pubkey_bytes));
    // --- End Debugging ---

    let boundary = generate_boundary();
    let mut body = Vec::new();

    // Add content field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body.extend_from_slice(content.as_bytes());
    body.extend_from_slice(b"\r\n");

    // Add quote_of field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"quote_of\"\r\n\r\n");
    body.extend_from_slice(b"");
    body.extend_from_slice(b"\r\n");

    // Add closing boundary
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    let request = Request::builder()
        .method(http::Method::POST)
        .uri(format!("/threads/{}/posts", thread_id))
        .header(
            http::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        // Add auth headers
        .header(
            HeaderName::from_static("x-polycentric-pubkey-base64"),
            auth_headers.get("x-polycentric-pubkey-base64").unwrap(),
        )
        .header(
            HeaderName::from_static("x-polycentric-signature-base64"),
            auth_headers.get("x-polycentric-signature-base64").unwrap(),
        )
        .header(
            HeaderName::from_static("x-polycentric-challenge-id"),
            auth_headers.get("x-polycentric-challenge-id").unwrap(),
        )
        .body(Body::from(body))
        .unwrap();

    let response: Response = app.clone().oneshot(request).await.unwrap();

    let status = response.status();
    let response_body = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();

    (status, response_body, pubkey_bytes)
}
