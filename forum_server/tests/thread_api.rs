// tests/thread_api.rs
// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, Request, StatusCode, HeaderName},
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
use ed25519_dalek::SigningKey;

// Bring helpers into scope
use common::helpers::{create_test_app, create_test_category, create_test_board, create_test_thread, create_test_post, generate_test_keypair, get_auth_headers};

// --- Thread Tests --- 

#[sqlx::test]
async fn test_create_thread_success(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Thread Test Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Thread Test Board", &admin_keypair).await;
    let keypair = generate_test_keypair(); // Keypair for the thread creator

    let thread_title = "My First Thread";
    let thread_content = "Initial post content for the first thread.";

    let (thread_id, initial_post_id) = create_test_thread(&app, board_id, thread_title, thread_content, &keypair).await;

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
    let body = fetch_response.into_body().collect().await.unwrap().to_bytes();
    let created_thread: Thread = serde_json::from_slice(&body).expect("Failed to deserialize thread");

    assert_eq!(created_thread.title, thread_title);
    assert_eq!(created_thread.created_by, keypair.verifying_key().to_bytes().to_vec());
    assert_eq!(created_thread.board_id, board_id);

    let saved_thread = sqlx::query_as::<_, Thread>("SELECT * FROM threads WHERE id = $1")
        .bind(created_thread.id)
        .fetch_one(&pool)
        .await
        .expect("Failed to fetch thread from DB");
    assert_eq!(saved_thread.id, created_thread.id);
    assert_eq!(saved_thread.title, thread_title);
    assert_eq!(saved_thread.created_by, keypair.verifying_key().to_bytes().to_vec());
}

#[sqlx::test]
async fn test_create_thread_invalid_board(pool: PgPool) {
    // No admin needed for app setup here, as we aren't creating category/board
    let app = create_test_app(pool, None).await;
    let non_existent_board_id = Uuid::new_v4();
    let keypair = generate_test_keypair();
    let auth_headers = get_auth_headers(&app, &keypair).await;

    // ---> REPLACED JSON with Multipart Simulation <---
    let boundary = common::helpers::generate_boundary(); // Use helper
    let mut body_bytes = Vec::new();
    let title = "Fail Thread";
    let content = "Fail content";

    // Add title field
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"title\"\r\n\r\n");
    body_bytes.extend_from_slice(title.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");

    // Add content field
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body_bytes.extend_from_slice(content.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");

    // Add closing boundary
    body_bytes.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    let content_type = format!("multipart/form-data; boundary={}", boundary);

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/boards/{}/threads", non_existent_board_id))
                .header(http::header::CONTENT_TYPE, content_type) // Use multipart content type
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(body_bytes)) // Send byte vector
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_get_thread_success(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Get Thread Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Get Thread Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair(); // Keypair for thread creator
    let (thread_id, _initial_post_id) = create_test_thread(&app, board_id, "Test Thread Title", "Initial post content", &thread_keypair).await;
    let expected_author_id = thread_keypair.verifying_key().to_bytes().to_vec();

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
    assert_eq!(fetched_thread.title, "Test Thread Title");
    assert_eq!(fetched_thread.board_id, board_id);
    assert_eq!(fetched_thread.created_by, expected_author_id);
}

#[sqlx::test]
async fn test_get_thread_not_found(pool: PgPool) {
    // No admin needed for app setup
    let app = create_test_app(pool, None).await;
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
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "List Threads Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "List Threads Board", &admin_keypair).await;
    let keypair1 = generate_test_keypair();
    let keypair2 = generate_test_keypair();
    let keypair3 = generate_test_keypair();

    let (thread1_id, _initial_post_id) = create_test_thread(&app, board_id, "Thread 1", "Content 1", &keypair1).await;
    let (thread2_id, _initial_post_id) = create_test_thread(&app, board_id, "Thread 2", "Content 2", &keypair2).await;
    let (thread3_id, _initial_post_id) = create_test_thread(&app, board_id, "Thread 3", "Content 3", &keypair3).await;

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
    assert_eq!(threads_page1[0].id, thread3_id);
    assert_eq!(threads_page1[1].id, thread2_id);

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

    let response_default = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/boards/{}/threads", board_id))
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
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Update Thread Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Update Thread Board", &admin_keypair).await;
    let thread_owner_keypair = generate_test_keypair(); // Keypair for thread creation & update
    let thread_title = "Thread to Update";
    let thread_content = "Original content.";

    let (thread_id, initial_post_id) = create_test_thread(&app, board_id, thread_title, thread_content, &thread_owner_keypair).await;

    let updated_title = "Updated Thread Title";

    // Get auth headers using the *same* keypair that created the thread
    let auth_headers = get_auth_headers(&app, &thread_owner_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/threads/{}", thread_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                 // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
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
    assert_eq!(updated_thread.board_id, board_id);
    assert_eq!(updated_thread.created_by, thread_owner_keypair.verifying_key().to_bytes().to_vec());

    let saved_thread = sqlx::query_as::<_, Thread>("SELECT * FROM threads WHERE id = $1")
        .bind(thread_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_thread.title, updated_title);
    assert_eq!(saved_thread.created_by, thread_owner_keypair.verifying_key().to_bytes().to_vec());
}

#[sqlx::test]
async fn test_update_thread_unauthorized(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Update Unauthorized Thread Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Update Unauthorized Thread Board", &admin_keypair).await;
    let thread_owner_keypair = generate_test_keypair(); // Keypair of the thread creator
    let attacker_keypair = generate_test_keypair(); // Different keypair for the attacker
    let thread_title = "Original Thread Title";
    let thread_content = "Content by owner.";

    let (thread_id, initial_post_id) = create_test_thread(&app, board_id, thread_title, thread_content, &thread_owner_keypair).await;

    let updated_title = "Attacker Title Update";

    // Get auth headers using the *attacker's* keypair
    let attacker_auth_headers = get_auth_headers(&app, &attacker_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/threads/{}", thread_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                 // Add attacker's auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), attacker_auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), attacker_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), attacker_auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(json!({ "title": updated_title }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    // Expect 403 Forbidden
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // Verify the thread title was NOT updated in the DB
    let saved_thread = sqlx::query!("SELECT title FROM threads WHERE id = $1", thread_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_thread.title, thread_title); // Check it's still the original
}

#[sqlx::test]
async fn test_update_thread_not_found(pool: PgPool) {
    // No admin needed for app setup
    let app = create_test_app(pool, None).await;
    let non_existent_thread_id = Uuid::new_v4();
    let keypair = generate_test_keypair(); // Need a keypair for auth
    let auth_headers = get_auth_headers(&app, &keypair).await;

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/threads/{}", non_existent_thread_id))
                 // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "title": "n" }).to_string())) // Still need a valid body
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_thread_success(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Delete Thread Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Delete Thread Board", &admin_keypair).await;
    let thread_owner_keypair = generate_test_keypair(); // Keypair for thread creation & delete
    let thread_title = "Thread to Delete";
    let thread_content = "This thread will be deleted.";

    let (thread_id, initial_post_id) = create_test_thread(&app, board_id, thread_title, thread_content, &thread_owner_keypair).await;

    // Get auth headers using the *same* keypair that created the thread
    let auth_headers = get_auth_headers(&app, &thread_owner_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/threads/{}", thread_id))
                // ---> ADDED Content-Type <---
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let result = sqlx::query("SELECT 1 FROM threads WHERE id = $1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(result.is_none());
}

#[sqlx::test]
async fn test_delete_thread_unauthorized(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Delete Unauthorized Thread Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Delete Unauthorized Thread Board", &admin_keypair).await;
    let thread_owner_keypair = generate_test_keypair(); // Keypair of the thread creator
    let attacker_keypair = generate_test_keypair(); // Different keypair for the attacker
    let thread_title = "Thread To Delete (Unauth)";
    let thread_content = "Content by owner.";

    let (thread_id, initial_post_id) = create_test_thread(&app, board_id, thread_title, thread_content, &thread_owner_keypair).await;

    // Get auth headers using the *attacker's* keypair
    let attacker_auth_headers = get_auth_headers(&app, &attacker_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/threads/{}", thread_id))
                // Add attacker's auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), attacker_auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), attacker_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), attacker_auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Expect 403 Forbidden
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // Verify the thread still exists in the DB
    let result = sqlx::query("SELECT 1 FROM threads WHERE id = $1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(result.is_some(), "Thread was deleted unexpectedly");
}

#[sqlx::test]
async fn test_delete_thread_not_found(pool: PgPool) {
    // No admin needed for app setup
    let app = create_test_app(pool, None).await;
    let non_existent_id = Uuid::new_v4();
    let keypair = generate_test_keypair(); // Need keypair even for not found
    let auth_headers = get_auth_headers(&app, &keypair).await;
    
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/threads/{}", non_existent_id))
                 // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_thread_cascade(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let category_id = create_test_category(&app, "Delete Thread Cascade Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Delete Thread Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair(); // Keypair for thread creator
    let (thread_id, initial_post_id) = create_test_thread(&app, board_id, "Thread To Delete", "Initial post", &thread_keypair).await;

    // Verify thread and post exist initially
    let thread_exists: Option<bool> = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)")
        .bind(thread_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(thread_exists.unwrap_or(false), "Thread should exist before delete");

    let post_exists: Option<bool> = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)")
        .bind(initial_post_id) // Use initial_post_id
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(post_exists.unwrap_or(false), "Initial post should exist before delete");

    // Get auth headers for delete using the creator's keypair
    let delete_auth_headers = get_auth_headers(&app, &thread_keypair).await;

    // Send DELETE request
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/threads/{}", thread_id))
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), delete_auth_headers.get("x-polycentric-pubkey-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-signature-base64"), delete_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), delete_auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Verify thread is gone
    let thread_exists_after: Option<bool> = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)")
        .bind(thread_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!thread_exists_after.unwrap_or(true), "Thread should be deleted");

    // Verify post is gone (due to cascade)
    let post_exists_after: Option<bool> = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)")
        .bind(initial_post_id) // Use initial_post_id
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!post_exists_after.unwrap_or(true), "Post should be cascade deleted");
}