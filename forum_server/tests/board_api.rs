// tests/board_api.rs
// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, HeaderName, Request, StatusCode},
    // Router, // Router is unused
};
use forum_server::{
    create_router,
    models::{Board, Post}, // Add Post back
};
use http_body_util::BodyExt;
use serde_json::json;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;
// use sqlx::Row; // Row is unused

// Bring helpers into scope
use common::helpers::{
    create_test_app, create_test_board, create_test_category, create_test_post, create_test_thread,
    generate_test_keypair, get_auth_headers,
};

#[sqlx::test]
async fn test_create_board_success(pool: PgPool) {
    // Setup admin user
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;

    let category_id = create_test_category(&app, "Board Test Cat", &admin_keypair).await;

    let board_name = "My First Board";
    let board_desc = "Discussion about the first board";

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
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
                    json!({
                        "name": board_name,
                        "description": board_desc
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_board: Board = serde_json::from_slice(&body).expect("Failed to deserialize board");

    assert_eq!(created_board.name, board_name);
    assert_eq!(created_board.description, board_desc);
    assert_eq!(created_board.category_id, category_id);

    // Verify in DB
    let saved_board = sqlx::query_as::<_, Board>("SELECT * FROM boards WHERE id = $1")
        .bind(created_board.id)
        .fetch_one(&pool)
        .await
        .expect("Failed to fetch board from DB");
    assert_eq!(saved_board.id, created_board.id);
    assert_eq!(saved_board.name, board_name);
}

#[sqlx::test]
async fn test_create_board_unauthorized(pool: PgPool) {
    // Setup non-admin user and admin for category creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let non_admin_keypair = generate_test_keypair();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let category_id = create_test_category(&app, "Board Auth Test Cat", &admin_keypair).await;
    let non_admin_auth_headers = get_auth_headers(&app, &non_admin_keypair).await;

    // Attempt creation with non-admin user
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .header(
                    HeaderName::from_static("x-polycentric-pubkey-base64"),
                    non_admin_auth_headers
                        .get("x-polycentric-pubkey-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-signature-base64"),
                    non_admin_auth_headers
                        .get("x-polycentric-signature-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-challenge-id"),
                    non_admin_auth_headers
                        .get("x-polycentric-challenge-id")
                        .unwrap(),
                )
                .body(Body::from(
                    json!({ "name": "Unauthorized Board", "description": "Should Fail" })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED); // Or FORBIDDEN
}

#[sqlx::test]
async fn test_create_board_invalid_category(pool: PgPool) {
    // Setup admin user (required for the endpoint)
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let non_existent_category_id = Uuid::new_v4();

    // Send request with admin auth (auth passes, but category ID is bad)
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", non_existent_category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
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
                    json!({ "name": "Fail Board", "description": "Should fail" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_get_board_success(pool: PgPool) {
    // Setup admin for creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let category_id = create_test_category(&app, "Get Board Test Cat", &admin_keypair).await;

    // Create a board (requires admin)
    // Need to use the create_test_board helper after updating it, or inline creation with auth
    // For now, inline creation:
    let admin_auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .header(
                    HeaderName::from_static("x-polycentric-pubkey-base64"),
                    admin_auth_headers
                        .get("x-polycentric-pubkey-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-signature-base64"),
                    admin_auth_headers
                        .get("x-polycentric-signature-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-challenge-id"),
                    admin_auth_headers
                        .get("x-polycentric-challenge-id")
                        .unwrap(),
                )
                .body(Body::from(
                    json!({ "name": "Board To Get", "description": "Get me!" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_body = create_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let created_board: Board = serde_json::from_slice(&create_body).unwrap();
    let board_id = created_board.id;

    // Fetch the board (no auth needed)
    let fetch_response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/boards/{}", board_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(fetch_response.status(), StatusCode::OK);
    let fetch_body = fetch_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let fetched_board: Board = serde_json::from_slice(&fetch_body).unwrap();

    assert_eq!(fetched_board.id, board_id);
    assert_eq!(fetched_board.name, "Board To Get");
    assert_eq!(fetched_board.category_id, category_id);
}

#[sqlx::test]
async fn test_get_board_not_found(pool: PgPool) {
    let app = create_test_app(pool, None).await; // No admin needed
    let non_existent_board_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/boards/{}", non_existent_board_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_list_boards_in_category_pagination(pool: PgPool) {
    // Setup admin for creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let category_id = create_test_category(&app, "List Boards Test Cat", &admin_keypair).await;

    // Create 3 boards (requires admin)
    // TODO: Update create_test_board helper first
    let board1_id = create_test_board(&app, category_id, "Board 1", &admin_keypair).await;
    let board2_id = create_test_board(&app, category_id, "Board 2", &admin_keypair).await;
    let board3_id = create_test_board(&app, category_id, "Board 3", &admin_keypair).await;

    // Fetch (no auth needed)
    let response_page1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/categories/{}/boards?limit=2", category_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_page1.status(), StatusCode::OK);
    let body1 = response_page1
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let boards_page1: Vec<Board> = serde_json::from_slice(&body1).unwrap();
    assert_eq!(boards_page1.len(), 2);
    assert_eq!(boards_page1[0].id, board1_id);
    assert_eq!(boards_page1[1].id, board2_id);

    let response_page2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!(
                    "/categories/{}/boards?limit=2&offset=2",
                    category_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_page2.status(), StatusCode::OK);
    let body2 = response_page2
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let boards_page2: Vec<Board> = serde_json::from_slice(&body2).unwrap();
    assert_eq!(boards_page2.len(), 1);
    assert_eq!(boards_page2[0].id, board3_id);

    let response_default = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/categories/{}/boards", category_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_default.status(), StatusCode::OK);
    let body_default = response_default
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let boards_default: Vec<Board> = serde_json::from_slice(&body_default).unwrap();
    assert_eq!(boards_default.len(), 3);
}

#[sqlx::test]
async fn test_update_board_success(pool: PgPool) {
    // Setup admin user
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let category_id = create_test_category(&app, "Update Board Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Board to Update", &admin_keypair).await;

    let updated_name = "Updated Board Name";
    let updated_desc = "New description.";

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/boards/{}", board_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
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
                    json!({ "name": updated_name, "description": updated_desc }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let updated_board: Board = serde_json::from_slice(&body).unwrap();
    assert_eq!(updated_board.id, board_id);
    assert_eq!(updated_board.name, updated_name);
    assert_eq!(updated_board.description, updated_desc);
    assert_eq!(updated_board.category_id, category_id);
    let saved_board = sqlx::query_as::<_, Board>("SELECT * FROM boards WHERE id = $1")
        .bind(board_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_board.name, updated_name);
    assert_eq!(saved_board.description, updated_desc);
}

#[sqlx::test]
async fn test_update_board_unauthorized(pool: PgPool) {
    // Setup admin for creation, non-admin for update attempt
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let non_admin_keypair = generate_test_keypair();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let category_id = create_test_category(&app, "Update Board Auth Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Update Auth Board", &admin_keypair).await;
    let non_admin_auth_headers = get_auth_headers(&app, &non_admin_keypair).await;

    // Attempt update with non-admin
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/boards/{}", board_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .header(
                    HeaderName::from_static("x-polycentric-pubkey-base64"),
                    non_admin_auth_headers
                        .get("x-polycentric-pubkey-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-signature-base64"),
                    non_admin_auth_headers
                        .get("x-polycentric-signature-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-challenge-id"),
                    non_admin_auth_headers
                        .get("x-polycentric-challenge-id")
                        .unwrap(),
                )
                .body(Body::from(
                    json!({ "name": "Fail Update", "description": "Should Fail" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED); // Or FORBIDDEN
}

#[sqlx::test]
async fn test_update_board_not_found(pool: PgPool) {
    // Setup admin user (required for the endpoint)
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let non_existent_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/boards/{}", non_existent_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
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
                    json!({ "name": "n", "description": "d" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_board_success(pool: PgPool) {
    // Setup admin user
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let category_id = create_test_category(&app, "Delete Board Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Board to Delete", &admin_keypair).await;

    // Send DELETE request with admin auth
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/boards/{}", board_id))
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
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Verify directly in DB
    let result = sqlx::query("SELECT 1 FROM boards WHERE id = $1")
        .bind(board_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(result.is_none());
}

#[sqlx::test]
async fn test_delete_board_unauthorized(pool: PgPool) {
    // Setup admin for creation, non-admin for delete attempt
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let non_admin_keypair = generate_test_keypair();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let category_id = create_test_category(&app, "Delete Board Auth Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Delete Auth Board", &admin_keypair).await;
    let non_admin_auth_headers = get_auth_headers(&app, &non_admin_keypair).await;

    // Attempt delete with non-admin
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/boards/{}", board_id))
                .header(
                    HeaderName::from_static("x-polycentric-pubkey-base64"),
                    non_admin_auth_headers
                        .get("x-polycentric-pubkey-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-signature-base64"),
                    non_admin_auth_headers
                        .get("x-polycentric-signature-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-challenge-id"),
                    non_admin_auth_headers
                        .get("x-polycentric-challenge-id")
                        .unwrap(),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED); // Or FORBIDDEN

    // Verify board still exists
    let result = sqlx::query("SELECT 1 FROM boards WHERE id = $1")
        .bind(board_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(result.is_some());
}

#[sqlx::test]
async fn test_delete_board_not_found(pool: PgPool) {
    // Setup admin user (required for the endpoint)
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let non_existent_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/boards/{}", non_existent_id))
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
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_board_cascade(pool: PgPool) {
    // Setup admin user
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey.clone()])).await;
    let admin_auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let category_id = create_test_category(&app, "Cascade Board Cat", &admin_keypair).await;
    let board_id =
        create_test_board(&app, category_id, "Cascade Delete Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let (thread_id, initial_post_id) = create_test_thread(
        &app,
        board_id,
        "Thread To Delete",
        "Content",
        &thread_keypair,
    )
    .await;

    // Verify thread and post exist initially
    let thread_result = sqlx::query!("SELECT id FROM threads WHERE id = $1", thread_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(thread_result.is_some());

    let post_result = sqlx::query!("SELECT id FROM posts WHERE id = $1", initial_post_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(post_result.is_some());

    // Send DELETE request for the board using admin auth
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/boards/{}", board_id))
                .header(
                    HeaderName::from_static("x-polycentric-pubkey-base64"),
                    admin_auth_headers
                        .get("x-polycentric-pubkey-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-signature-base64"),
                    admin_auth_headers
                        .get("x-polycentric-signature-base64")
                        .unwrap(),
                )
                .header(
                    HeaderName::from_static("x-polycentric-challenge-id"),
                    admin_auth_headers
                        .get("x-polycentric-challenge-id")
                        .unwrap(),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Verify board is gone
    let board_result = sqlx::query("SELECT 1 FROM boards WHERE id = $1")
        .bind(board_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(board_result.is_none(), "Board should be deleted");

    // Verify thread is gone (due to cascade)
    let thread_result = sqlx::query("SELECT 1 FROM threads WHERE id = $1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(thread_result.is_none(), "Thread should be cascade deleted");

    // Verify post is gone (due to cascade)
    let post_result = sqlx::query("SELECT 1 FROM posts WHERE id = $1")
        .bind(initial_post_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(post_result.is_none(), "Post should be cascade deleted");
}
