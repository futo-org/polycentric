// tests/common/helpers.rs
//! Shared helper functions for integration tests

use axum::{
    body::Body,
    http::{self, Request, StatusCode},
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


pub async fn create_test_app(pool: PgPool) -> Router {
    create_router(pool)
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
    images: Option<Vec<String>>
) -> Uuid {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ 
                    "content": content, 
                    "author_id": author, 
                    "quote_of": Option::<Uuid>::None, 
                    "images": images
                }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(status, StatusCode::CREATED, "Failed to create post: {}", String::from_utf8_lossy(&body));
    let post: Post = serde_json::from_slice(&body).expect("Failed to deserialize post in helper");
    post.id
} 