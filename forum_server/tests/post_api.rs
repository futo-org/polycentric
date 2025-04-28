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
use sqlx::Row;

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
                        "quote_of": Option::<Uuid>::None,
                        "images": Option::<Vec<String>>::None // Explicitly no images
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
    assert!(created_post.images.is_empty()); // Assert images is empty

    // Verify in DB
    let image_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_images WHERE post_id = $1")
        .bind(created_post.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(image_count, 0);

    // Re-fetch base post data to check content
    let saved_post_base = sqlx::query!("SELECT content FROM posts WHERE id = $1", created_post.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_post_base.content, post_content);
}

#[sqlx::test]
async fn test_create_post_with_images(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Img Post Cat").await;
    let board_id = create_test_board(&app, category_id, "Img Post Board").await;
    let thread_id = create_test_thread(&app, board_id, "Img Post Thread").await;

    let post_content = "This post has images!";
    let author_id = "user_img";
    let image_urls = vec!["http://example.com/img1.jpg".to_string(), "http://example.com/img2.png".to_string()];

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
                        "quote_of": Option::<Uuid>::None,
                        "images": image_urls // Pass image URLs
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
    assert_eq!(created_post.images.len(), 2);
    assert_eq!(created_post.images[0].image_url, image_urls[0]);
    assert_eq!(created_post.images[1].image_url, image_urls[1]);
    assert_eq!(created_post.images[0].post_id, created_post.id);
    assert_eq!(created_post.images[1].post_id, created_post.id);

    // Verify images in DB
    let saved_images = sqlx::query_as::<_, forum_server::models::PostImage>(
        "SELECT * FROM post_images WHERE post_id = $1 ORDER BY created_at ASC")
        .bind(created_post.id)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(saved_images.len(), 2);
    assert_eq!(saved_images[0].image_url, image_urls[0]);
    assert_eq!(saved_images[1].image_url, image_urls[1]);
}

#[sqlx::test]
async fn test_create_post_with_quote(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Quote Test Cat").await;
    let board_id = create_test_board(&app, category_id, "Quote Test Board").await;
    let thread_id = create_test_thread(&app, board_id, "Quote Test Thread").await;
    let first_post_id = create_test_post(&app, thread_id, "First post content", "user1", None).await;

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
    assert!(created_post.images.is_empty()); // Assert quoted post has no images
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
    let image_urls = vec!["http://get.me/img.png".to_string()];
    let post_id = create_test_post(&app, thread_id, "Post to get", "user1", Some(image_urls.clone())).await;

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
    assert_eq!(fetched_post.images.len(), 1);
    assert_eq!(fetched_post.images[0].image_url, image_urls[0]);
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
async fn test_list_posts_in_thread_pagination(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "List Posts Cat").await;
    let board_id = create_test_board(&app, category_id, "List Posts Board").await;
    let thread_id = create_test_thread(&app, board_id, "List Posts Thread").await;

    // Create 3 posts, one with an image
    let post1_id = create_test_post(&app, thread_id, "Post one", "userA", None).await;
    let post2_id = create_test_post(&app, thread_id, "Post two with image", "userB", Some(vec!["img.jpg".to_string()])).await;
    let post3_id = create_test_post(&app, thread_id, "Post three", "userC", None).await;

    // Fetch first page (limit 2)
    let response_page1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/threads/{}/posts?limit=2", thread_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response_page1.status(), StatusCode::OK);
    let body1 = response_page1.into_body().collect().await.unwrap().to_bytes();
    let posts_page1: Vec<Post> = serde_json::from_slice(&body1).unwrap();

    assert_eq!(posts_page1.len(), 2);
    assert_eq!(posts_page1[0].id, post1_id); // Ordered ASC
    assert!(posts_page1[0].images.is_empty());
    assert_eq!(posts_page1[1].id, post2_id);
    assert_eq!(posts_page1[1].images.len(), 1);
    assert_eq!(posts_page1[1].images[0].image_url, "img.jpg");

    // Fetch second page (limit 2, offset 2)
    let response_page2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/threads/{}/posts?limit=2&offset=2", thread_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response_page2.status(), StatusCode::OK);
    let body2 = response_page2.into_body().collect().await.unwrap().to_bytes();
    let posts_page2: Vec<Post> = serde_json::from_slice(&body2).unwrap();

    assert_eq!(posts_page2.len(), 1);
    assert_eq!(posts_page2[0].id, post3_id);
    assert!(posts_page2[0].images.is_empty());

    // Test default limit (should return all 3)
    let response_default = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/threads/{}/posts", thread_id)) // No params
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_default.status(), StatusCode::OK);
    let body_default = response_default.into_body().collect().await.unwrap().to_bytes();
    let posts_default: Vec<Post> = serde_json::from_slice(&body_default).unwrap();
    assert_eq!(posts_default.len(), 3);
    assert!(posts_default[0].images.is_empty());
    assert_eq!(posts_default[1].images.len(), 1);
    assert!(posts_default[2].images.is_empty());
}

#[sqlx::test]
async fn test_update_post_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Update Post Cat").await;
    let board_id = create_test_board(&app, category_id, "Update Post Board").await;
    let thread_id = create_test_thread(&app, board_id, "Update Post Thread").await;
    let initial_images = Some(vec!["original_image.png".to_string()]);
    let post_id = create_test_post(&app, thread_id, "Original content", "user1", initial_images.clone()).await;

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
    assert_eq!(updated_post.images.len(), 1);
    assert_eq!(updated_post.images[0].image_url, initial_images.unwrap()[0]);

    // Verify content in DB - Using query! macro for specific field
    let saved_content = sqlx::query!("SELECT content FROM posts WHERE id = $1", post_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .content;
    assert_eq!(saved_content, updated_content);

    // Verify image still exists in DB
    let image_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_images WHERE post_id = $1")
        .bind(post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(image_count, 1);
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
    let post_id = create_test_post(&app, thread_id, "Post to Delete", "user1", Some(vec!["delete.jpg".to_string()])).await;

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

    // Verify associated image is gone (due to cascade)
    let image_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_images WHERE post_id = $1")
        .bind(post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(image_count, 0);

    // Test that quote_of references were handled (should be set to NULL by DB)
    // Create another post quoting the first one before deleting
    let quoting_post_id = create_test_post(&app, thread_id, "Quoting deleted post", "user2", None).await;
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

#[sqlx::test]
async fn test_delete_post_sets_quote_null(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Quote Null Cat").await;
    let board_id = create_test_board(&app, category_id, "Quote Null Board").await;
    let thread_id = create_test_thread(&app, board_id, "Quote Null Thread").await;
    let post_to_delete_id = create_test_post(&app, thread_id, "Post to be quoted and deleted", "user1", Some(vec!["deleted.png".to_string()])).await;

    // Create the quoting post directly in DB (with its own image)
    let quoting_post_id = Uuid::new_v4();
    let quoting_image_url = "quoting.gif";
    sqlx::query!(
        "INSERT INTO posts (id, thread_id, author_id, content, quote_of) VALUES ($1, $2, $3, $4, $5)",
        quoting_post_id,
        thread_id,
        "user2",
        "I am quoting a post that will be deleted",
        post_to_delete_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)", quoting_post_id, quoting_image_url)
    .execute(&pool)
    .await
    .unwrap();

    // Send DELETE request for the *quoted* post
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/posts/{}", post_to_delete_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Verify the quoted post is gone
    let deleted_post_exists: Option<bool> = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)")
        .bind(post_to_delete_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!deleted_post_exists.unwrap_or(true));

    // Verify the quoting post still exists and its quote_of is NULL
    let quoting_post_full = forum_server::repositories::post_repository::get_post_by_id(&pool, quoting_post_id).await.unwrap().unwrap();

    assert!(quoting_post_full.quote_of.is_none(), "quote_of was not set to NULL");
    // Verify quoting post's image is still there
    assert_eq!(quoting_post_full.images.len(), 1);
    assert_eq!(quoting_post_full.images[0].image_url, quoting_image_url);
}

// TODO: Add test for unauthorized delete attempt later 