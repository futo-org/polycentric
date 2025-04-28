// tests/thread_api.rs
// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, Request, StatusCode},
};
use forum_server::{
    create_router,
    models::{Thread, Post},
};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;
use serde_json::json;
use uuid::Uuid;

// Bring helpers into scope
use common::helpers::{create_test_app, create_test_category, create_test_board, create_test_thread, create_test_post};

// --- Thread Tests --- 

#[sqlx::test]
async fn test_create_thread_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Thread Test Cat").await;
    let board_id = create_test_board(&app, category_id, "Thread Test Board").await;

    let thread_title = "My First Thread";
    let author_id = "polycentric_user_123";

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/boards/{}/threads", board_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(
                    json!({
                        "title": thread_title,
                        "created_by": author_id
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_thread: Thread = serde_json::from_slice(&body).expect("Failed to deserialize thread");

    assert_eq!(created_thread.title, thread_title);
    assert_eq!(created_thread.created_by, author_id);
    assert_eq!(created_thread.board_id, board_id);

    // Verify in DB
    let saved_thread = sqlx::query_as::<_, Thread>("SELECT * FROM threads WHERE id = $1")
        .bind(created_thread.id)
        .fetch_one(&pool)
        .await
        .expect("Failed to fetch thread from DB");
    assert_eq!(saved_thread.id, created_thread.id);
    assert_eq!(saved_thread.title, thread_title);
}

#[sqlx::test]
async fn test_create_thread_invalid_board(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_board_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/boards/{}/threads", non_existent_board_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "title": "Fail Thread", "created_by": "user" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_get_thread_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Get Thread Cat").await;
    let board_id = create_test_board(&app, category_id, "Get Thread Board").await;

    // Use helper to create thread
    let thread_id = create_test_thread(&app, board_id, "Thread To Get").await;

    // Fetch the thread
    let fetch_response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/threads/{}", thread_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(fetch_response.status(), StatusCode::OK);
    let fetch_body = fetch_response.into_body().collect().await.unwrap().to_bytes();
    let fetched_thread: Thread = serde_json::from_slice(&fetch_body).unwrap();

    assert_eq!(fetched_thread.id, thread_id);
    assert_eq!(fetched_thread.title, "Thread To Get");
    assert_eq!(fetched_thread.board_id, board_id);
}

#[sqlx::test]
async fn test_get_thread_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_thread_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/threads/{}", non_existent_thread_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_list_threads_in_board_pagination(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "List Threads Cat").await;
    let board_id = create_test_board(&app, category_id, "List Threads Board").await;

    // Create 3 threads
    let thread1_id = create_test_thread(&app, board_id, "Thread 1").await;
    let thread2_id = create_test_thread(&app, board_id, "Thread 2").await;
    let thread3_id = create_test_thread(&app, board_id, "Thread 3").await;

    // Fetch first page (limit 2)
    let response_page1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/boards/{}/threads?limit=2", board_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response_page1.status(), StatusCode::OK);
    let body1 = response_page1.into_body().collect().await.unwrap().to_bytes();
    let threads_page1: Vec<Thread> = serde_json::from_slice(&body1).unwrap();

    assert_eq!(threads_page1.len(), 2);
    assert_eq!(threads_page1[0].id, thread3_id); // Ordered DESC
    assert_eq!(threads_page1[1].id, thread2_id);

    // Fetch second page (limit 2, offset 2)
    let response_page2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/boards/{}/threads?limit=2&offset=2", board_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response_page2.status(), StatusCode::OK);
    let body2 = response_page2.into_body().collect().await.unwrap().to_bytes();
    let threads_page2: Vec<Thread> = serde_json::from_slice(&body2).unwrap();

    assert_eq!(threads_page2.len(), 1);
    assert_eq!(threads_page2[0].id, thread1_id);

    // Test default limit (should return all 3)
    let response_default = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/boards/{}/threads", board_id)) // No params
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_default.status(), StatusCode::OK);
    let body_default = response_default.into_body().collect().await.unwrap().to_bytes();
    let threads_default: Vec<Thread> = serde_json::from_slice(&body_default).unwrap();
    assert_eq!(threads_default.len(), 3);
}

#[sqlx::test]
async fn test_update_thread_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Update Thread Cat").await;
    let board_id = create_test_board(&app, category_id, "Update Thread Board").await;
    let thread_id = create_test_thread(&app, board_id, "Thread to Update").await;

    let updated_title = "Updated Thread Title";

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/threads/{}", thread_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "title": updated_title }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let updated_thread: Thread = serde_json::from_slice(&body).unwrap();
    assert_eq!(updated_thread.id, thread_id);
    assert_eq!(updated_thread.title, updated_title);
    assert_eq!(updated_thread.board_id, board_id); // Check board ID didn't change

    // Verify in DB
    let saved_thread = sqlx::query_as::<_, Thread>("SELECT * FROM threads WHERE id = $1")
        .bind(thread_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_thread.title, updated_title);
}

#[sqlx::test]
async fn test_update_thread_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/threads/{}", non_existent_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "title": "t" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_thread_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Delete Thread Cat").await;
    let board_id = create_test_board(&app, category_id, "Delete Thread Board").await;
    let thread_id = create_test_thread(&app, board_id, "Thread to Delete").await;

    // Send DELETE request
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/threads/{}", thread_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Verify directly in DB
    let result = sqlx::query("SELECT 1 FROM threads WHERE id = $1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(result.is_none());

    // Test cascade delete for posts later
}

#[sqlx::test]
async fn test_delete_thread_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/threads/{}", non_existent_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_thread_cascade(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Cascade Thread Cat").await;
    let board_id = create_test_board(&app, category_id, "Cascade Thread Board").await;
    let thread_id = create_test_thread(&app, board_id, "Cascade Thread").await;
    let post_content = "Post in thread to be deleted";
    let author_id = "cascade_user_thread";
    let (status, body_bytes) = create_test_post(&app, thread_id, post_content, author_id, None).await;
    assert_eq!(status, StatusCode::CREATED, "Helper failed to create post for thread cascade test");
    let post: Post = serde_json::from_slice(&body_bytes).expect("Failed to parse post in thread cascade test");
    let post_id = post.id;

    // Send DELETE request for the thread
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/threads/{}", thread_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Verify thread is gone
    let thread_exists: Option<bool> = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)")
        .bind(thread_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!thread_exists.unwrap_or(true));

    // Verify associated post is gone (due to thread cascade)
    let post_exists: Option<bool> = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)")
        .bind(post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!post_exists.unwrap_or(true));
} 