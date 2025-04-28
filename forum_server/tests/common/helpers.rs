// tests/common/helpers.rs
//! Shared helper functions for integration tests

use axum::{
    body::Body,
    http::{self, Request, StatusCode},
    response::Response,
    Router,
};
use forum_server::{
    create_router,
    models::{Board, Category, Post, Thread},
};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;
use serde_json::json;
use uuid::Uuid;

// Function to generate a random boundary string
pub fn generate_boundary() -> String {
    format!("----WebKitFormBoundary{}", Uuid::new_v4().simple())
}

pub async fn create_test_app(pool: PgPool) -> Router {
    // Provide dummy values for image storage config during testing
    let test_upload_dir = "./test_uploads".to_string();
    let test_base_url = "/test_images".to_string();
    create_router(pool, test_upload_dir, test_base_url)
}

// NOTE: Removed description from signature to match usage in post_api.rs
pub async fn create_test_category(app: &Router, name: &str) -> Uuid {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/categories")
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "name": name, "description": "..." }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    // Get status BEFORE consuming body
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(status, StatusCode::CREATED, "Failed to create category: {}", String::from_utf8_lossy(&body));
    let category: Category = serde_json::from_slice(&body).expect("Failed to deserialize category in helper");
    category.id
}

// NOTE: Removed description from signature to match usage in post_api.rs
pub async fn create_test_board(app: &Router, category_id: Uuid, name: &str) -> Uuid {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "name": name, "description": "..." }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    // Get status BEFORE consuming body
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(status, StatusCode::CREATED, "Failed to create board: {}", String::from_utf8_lossy(&body));
    let board: Board = serde_json::from_slice(&body).expect("Failed to deserialize board in helper");
    board.id
}

pub async fn create_test_thread(app: &Router, board_id: Uuid, title: &str) -> Uuid {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/boards/{}/threads", board_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "title": title, "created_by": "test_user" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    // Get status BEFORE consuming body
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(status, StatusCode::CREATED, "Failed to create thread: {}", String::from_utf8_lossy(&body));
    let thread: Thread = serde_json::from_slice(&body).expect("Failed to deserialize thread in helper");
    thread.id
}

pub async fn create_test_post(
    app: &Router,
    thread_id: Uuid,
    content: &str,
    author: &str,
    images: Option<Vec<String>> // This remains unused for body construction for now
) -> (StatusCode, Vec<u8>) {
    let boundary = generate_boundary();
    let mut body = Vec::new();

    // Add author_id field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"author_id\"\r\n\r\n");
    body.extend_from_slice(author.as_bytes());
    body.extend_from_slice(b"\r\n");

    // Add content field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body.extend_from_slice(content.as_bytes());
    body.extend_from_slice(b"\r\n");

    // Add quote_of field (optional, sending empty if None for simplicity in this helper)
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"quote_of\"\r\n\r\n");
    body.extend_from_slice(b""); 
    body.extend_from_slice(b"\r\n");

    // Add closing boundary
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
    
    // Use a variable for the built request
    let request = Request::builder()
        .method(http::Method::POST)
        .uri(format!("/threads/{}/posts", thread_id))
        .header(
            http::header::CONTENT_TYPE, 
            format!("multipart/form-data; boundary={}", boundary)
        )
        .body(Body::from(body))
        .unwrap();

    // Make the request
    let response: Response = app
        .clone()
        .oneshot(request)
        .await
        .unwrap();
        
    let status = response.status();
    let response_body = response.into_body().collect().await.unwrap().to_bytes().to_vec(); // Collect as Vec<u8>

    // Return the actual status and body instead of asserting/parsing
    (status, response_body)
} 