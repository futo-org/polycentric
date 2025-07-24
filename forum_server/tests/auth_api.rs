// tests/auth_api.rs

// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, Request, StatusCode},
};
use base64;
use forum_server::{
    // Assuming ChallengeResponse is exported from lib or auth module
    auth::ChallengeResponse,
};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid; // Use top-level import for 0.13

// Bring helpers into scope
use common::helpers::create_test_app;

#[sqlx::test]
async fn test_get_challenge_success(pool: PgPool) {
    let app = create_test_app(pool.clone(), None).await;

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/auth/challenge")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let challenge_resp: ChallengeResponse =
        serde_json::from_slice(&body).expect("Failed to deserialize challenge response");

    // Check UUID validity (parsing is enough)
    assert!(Uuid::parse_str(&challenge_resp.challenge_id.to_string()).is_ok());

    // Check nonce decoding and length
    let nonce_bytes = base64::decode(&challenge_resp.nonce_base64) // Use base64::decode for 0.13
        .expect("Failed to decode base64 nonce");

    // Should match NONCE_LENGTH in auth.rs
    assert_eq!(nonce_bytes.len(), 32, "Decoded nonce length is incorrect");
}
