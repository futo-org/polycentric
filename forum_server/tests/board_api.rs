// tests/board_api.rs
// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, Request, StatusCode},
    Router,
};
use forum_server::{
    models::{Board, Category},
};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;
use serde_json::json;
use uuid::Uuid;
use sqlx::Row; // Needed for checking existence with count(*)

// Bring helpers into scope
use common::helpers::{create_test_app, create_test_category, create_test_board, create_test_thread, create_test_post};

#[sqlx::test]
async fn test_create_board_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Board Test Cat").await;

    let board_name = "My First Board";
    let board_desc = "Discussion about the first board";

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
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
async fn test_create_board_invalid_category(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_category_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", non_existent_category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "name": "Fail Board", "description": "Should fail" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_get_board_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Get Board Test Cat").await;

    // Create a board
    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/categories/{}/boards", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "name": "Board To Get", "description": "Get me!" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_body = create_response.into_body().collect().await.unwrap().to_bytes();
    let created_board: Board = serde_json::from_slice(&create_body).unwrap();
    let board_id = created_board.id;

    // Fetch the board
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
    let fetch_body = fetch_response.into_body().collect().await.unwrap().to_bytes();
    let fetched_board: Board = serde_json::from_slice(&fetch_body).unwrap();

    assert_eq!(fetched_board.id, board_id);
    assert_eq!(fetched_board.name, "Board To Get");
    assert_eq!(fetched_board.category_id, category_id);
}

#[sqlx::test]
async fn test_get_board_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
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
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "List Boards Test Cat").await;

    // Create 3 boards
    let board1_id = create_test_board(&app, category_id, "Board 1").await;
    let board2_id = create_test_board(&app, category_id, "Board 2").await;
    let board3_id = create_test_board(&app, category_id, "Board 3").await;

    // Fetch first page (limit 2)
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
    let body1 = response_page1.into_body().collect().await.unwrap().to_bytes();
    let boards_page1: Vec<Board> = serde_json::from_slice(&body1).unwrap();

    assert_eq!(boards_page1.len(), 2);
    assert_eq!(boards_page1[0].id, board3_id); // Ordered DESC
    assert_eq!(boards_page1[1].id, board2_id);

    // Fetch second page (limit 2, offset 2)
    let response_page2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/categories/{}/boards?limit=2&offset=2", category_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response_page2.status(), StatusCode::OK);
    let body2 = response_page2.into_body().collect().await.unwrap().to_bytes();
    let boards_page2: Vec<Board> = serde_json::from_slice(&body2).unwrap();

    assert_eq!(boards_page2.len(), 1);
    assert_eq!(boards_page2[0].id, board1_id);

    // Test default limit (should return all 3)
    let response_default = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/categories/{}/boards", category_id)) // No params
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_default.status(), StatusCode::OK);
    let body_default = response_default.into_body().collect().await.unwrap().to_bytes();
    let boards_default: Vec<Board> = serde_json::from_slice(&body_default).unwrap();
    assert_eq!(boards_default.len(), 3);
}

#[sqlx::test]
async fn test_update_board_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Update Board Cat").await;
    let board_id = create_test_board(&app, category_id, "Board to Update").await;

    let updated_name = "Updated Board Name";
    let updated_desc = "New description.";

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/boards/{}", board_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "name": updated_name, "description": updated_desc }).to_string()))
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
    assert_eq!(updated_board.category_id, category_id); // Ensure category ID didn't change

    // Verify in DB
    let saved_board = sqlx::query_as::<_, Board>("SELECT * FROM boards WHERE id = $1")
        .bind(board_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_board.name, updated_name);
    assert_eq!(saved_board.description, updated_desc);
}

#[sqlx::test]
async fn test_update_board_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/boards/{}", non_existent_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "name": "n", "description": "d" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_board_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Delete Board Cat").await;
    let board_id = create_test_board(&app, category_id, "Board to Delete").await;

    // Send DELETE request
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/boards/{}", board_id))
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

    // We should also test that cascade delete worked for threads/posts later
}

#[sqlx::test]
async fn test_delete_board_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/boards/{}", non_existent_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_board_cascade(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Cascade Board Cat").await;
    let board_id = create_test_board(&app, category_id, "Cascade Board").await;
    let thread_id = create_test_thread(&app, board_id, "Cascade Thread").await;
    let post_id = create_test_post(&app, thread_id, "Cascade Post", "user1", None).await;

    // Send DELETE request for the board
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/boards/{}", board_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Verify board is gone
    let board_exists: Option<bool> = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM boards WHERE id = $1)")
        .bind(board_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!board_exists.unwrap_or(true));

    // Verify associated thread is gone (due to cascade)
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