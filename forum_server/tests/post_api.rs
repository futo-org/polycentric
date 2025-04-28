// tests/post_api.rs

// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, Request, StatusCode},
};
use forum_server::{
    models::Post,
};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;
use serde_json::json;
use uuid::Uuid;

// Bring helpers into scope
use common::helpers::{create_test_app, create_test_category, create_test_board, create_test_thread, create_test_post};

// --- Post Tests --- 

#[sqlx::test]
async fn test_create_post_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Post Test Cat").await;
    let board_id = create_test_board(&app, category_id, "Post Test Board").await;
    let thread_id = create_test_thread(&app, board_id, "Post Test Thread").await;

    let post_content = "This is the first post!";
    let author_id = "user1";

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(
                    json!({
                        "author_id": author_id,
                        "content": post_content,
                        "quote_of": Option::<Uuid>::None // Explicitly setting quote_of to null
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_post: Post = serde_json::from_slice(&body).unwrap();

    assert_eq!(created_post.content, post_content);
    assert_eq!(created_post.author_id, author_id);
    assert_eq!(created_post.thread_id, thread_id);
    assert!(created_post.quote_of.is_none());

    // Verify in DB
    let saved_post = sqlx::query_as::<_, Post>("SELECT * FROM posts WHERE id = $1")
        .bind(created_post.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_post.id, created_post.id);
    assert_eq!(saved_post.content, post_content);
}

#[sqlx::test]
async fn test_create_post_with_quote(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Quote Test Cat").await;
    let board_id = create_test_board(&app, category_id, "Quote Test Board").await;
    let thread_id = create_test_thread(&app, board_id, "Quote Test Thread").await;
    let first_post_id = create_test_post(&app, thread_id, "First post content", "user1").await;

    let quote_content = "Replying to the first post";
    let author_id = "user2";

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(
                    json!({
                        "author_id": author_id,
                        "content": quote_content,
                        "quote_of": first_post_id // Set quote_of to the ID of the first post
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_post: Post = serde_json::from_slice(&body).unwrap();

    assert_eq!(created_post.content, quote_content);
    assert_eq!(created_post.author_id, author_id);
    assert_eq!(created_post.thread_id, thread_id);
    assert_eq!(created_post.quote_of, Some(first_post_id));
}

#[sqlx::test]
async fn test_create_post_invalid_thread(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_thread_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", non_existent_thread_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "author_id": "u", "content": "c" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_create_post_invalid_quote(pool: PgPool) {
    let app = create_test_app(pool).await;
    let category_id = create_test_category(&app, "Inv Quote Cat").await;
    let board_id = create_test_board(&app, category_id, "Inv Quote Board").await;
    let thread_id = create_test_thread(&app, board_id, "Inv Quote Thread").await;
    let non_existent_post_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({
                    "author_id": "user1",
                    "content": "Trying to quote nothing",
                    "quote_of": non_existent_post_id
                }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST); // We check quote existence
}

#[sqlx::test]
async fn test_get_post_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Get Post Cat").await;
    let board_id = create_test_board(&app, category_id, "Get Post Board").await;
    let thread_id = create_test_thread(&app, board_id, "Get Post Thread").await;
    let post_id = create_test_post(&app, thread_id, "Post to get", "user1").await;

    let fetch_response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/posts/{}", post_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(fetch_response.status(), StatusCode::OK);
    let fetch_body = fetch_response.into_body().collect().await.unwrap().to_bytes();
    let fetched_post: Post = serde_json::from_slice(&fetch_body).unwrap();

    assert_eq!(fetched_post.id, post_id);
    assert_eq!(fetched_post.content, "Post to get");
    assert_eq!(fetched_post.thread_id, thread_id);
}

#[sqlx::test]
async fn test_get_post_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_post_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/posts/{}", non_existent_post_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_list_posts_in_thread(pool: PgPool) {
    let app = create_test_app(pool).await;
    let category_id = create_test_category(&app, "List Posts Cat").await;
    let board_id = create_test_board(&app, category_id, "List Posts Board").await;
    let thread_id = create_test_thread(&app, board_id, "List Posts Thread").await;

    // Create posts using helper
    let _post1_id = create_test_post(&app, thread_id, "Post one", "userA").await;
    let _post2_id = create_test_post(&app, thread_id, "Post two", "userB").await;

    // List posts
    let list_response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/threads/{}/posts", thread_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = list_response.into_body().collect().await.unwrap().to_bytes();
    let fetched_posts: Vec<Post> = serde_json::from_slice(&list_body).unwrap();

    assert_eq!(fetched_posts.len(), 2);
    // Query orders by created_at ASC
    assert_eq!(fetched_posts[0].content, "Post one");
    assert_eq!(fetched_posts[0].author_id, "userA");
    assert_eq!(fetched_posts[1].content, "Post two");
    assert_eq!(fetched_posts[1].author_id, "userB");
    assert!(fetched_posts.iter().all(|p| p.thread_id == thread_id));
}

#[sqlx::test]
async fn test_update_post_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Update Post Cat").await;
    let board_id = create_test_board(&app, category_id, "Update Post Board").await;
    let thread_id = create_test_thread(&app, board_id, "Update Post Thread").await;
    let post_id = create_test_post(&app, thread_id, "Original content", "user1").await;

    let updated_content = "This content has been edited.";

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/posts/{}", post_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "content": updated_content }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let updated_post: Post = serde_json::from_slice(&body).unwrap();
    assert_eq!(updated_post.id, post_id);
    assert_eq!(updated_post.content, updated_content);
    assert_eq!(updated_post.thread_id, thread_id); // Check thread ID didn't change
    assert_eq!(updated_post.author_id, "user1"); // Check author didn't change

    // Verify in DB
    let saved_post = sqlx::query_as::<_, Post>("SELECT * FROM posts WHERE id = $1")
        .bind(post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_post.content, updated_content);
}

#[sqlx::test]
async fn test_update_post_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/posts/{}", non_existent_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "content": "c" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_post_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Delete Post Cat").await;
    let board_id = create_test_board(&app, category_id, "Delete Post Board").await;
    let thread_id = create_test_thread(&app, board_id, "Delete Post Thread").await;
    let post_id = create_test_post(&app, thread_id, "Post to Delete", "user1").await;

    // Send DELETE request
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/posts/{}", post_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Verify directly in DB
    let result = sqlx::query("SELECT 1 FROM posts WHERE id = $1")
        .bind(post_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(result.is_none());

    // Test that quote_of references were handled (should be set to NULL by DB)
    // Create another post quoting the first one before deleting
    let quoting_post_id = create_test_post(&app, thread_id, "Quoting deleted post", "user2").await;
    let update_resp = app.clone().oneshot(Request::builder()
        .method(http::Method::PUT)
        .uri(format!("/posts/{}", quoting_post_id))
        .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
        // We need to allow updating quote_of to test this properly, or insert directly
        // For now, we'll assume the quote_of was set correctly. Let's fetch it.
        .body(Body::from(json!({ "content": "Quoting deleted post" }).to_string())) // Update content only for now
        .unwrap()).await.unwrap();
    assert_eq!(update_resp.status(), StatusCode::OK);

    // Re-fetch the quoting post after deleting the quoted post
    // This part needs more work: Need a way to set quote_of in tests or update the schema/logic
    // For now, this test mainly verifies the post is deleted.
}

#[sqlx::test]
async fn test_delete_post_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/posts/{}", non_existent_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

// TODO: Add test for unauthorized delete attempt later 