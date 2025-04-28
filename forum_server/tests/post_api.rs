// tests/post_api.rs

// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, Request, StatusCode},
};
use forum_server::{
    models::{Post, PostImage},
};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;
use serde_json::json;
use uuid::Uuid;
use sqlx::Row;
use mime::Mime;
use axum::body::Bytes;
use std::path::PathBuf;

// Bring helpers into scope
use common::helpers::{create_test_app, create_test_category, create_test_board, create_test_thread, create_test_post, generate_boundary};

// --- Post Tests --- 

#[sqlx::test]
async fn test_create_post_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Post Test Cat").await;
    let board_id = create_test_board(&app, category_id, "Post Test Board").await;
    let thread_id = create_test_thread(&app, board_id, "Post Test Thread").await;

    let post_content = "This is the first post!";
    let author_id = "user1";

    let (status, body_bytes) = create_test_post(&app, thread_id, post_content, author_id, None).await;

    assert_eq!(status, StatusCode::CREATED);
    let created_post: Post = serde_json::from_slice(&body_bytes).expect("Failed to deserialize post");

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
    
    // --- Simulate multipart form data --- 
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();

    // Add author_id field
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"author_id\"\r\n\r\n");
    body_bytes.extend_from_slice(author_id.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");

    // Add content field
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body_bytes.extend_from_slice(post_content.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");

    // Add quote_of field (even if empty, handler expects it)
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"quote_of\"\r\n\r\n");
    body_bytes.extend_from_slice(b""); // Empty for no quote
    body_bytes.extend_from_slice(b"\r\n");

    // Add image field
    let image_filename = "test_image.png";
    let image_content_type = mime::IMAGE_PNG;
    let image_bytes = Bytes::from_static(b"fake png data"); // Simple placeholder bytes

    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"image\"; filename=\"{}\"\r\n",
            image_filename
        )
        .as_bytes(),
    );
    body_bytes.extend_from_slice(format!("Content-Type: {}\r\n\r\n", image_content_type).as_bytes());
    body_bytes.extend_from_slice(&image_bytes);
    body_bytes.extend_from_slice(b"\r\n");

    // Add closing boundary
    body_bytes.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
    // --- End multipart simulation ---

    let content_type = format!("multipart/form-data; boundary={}", boundary);

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, content_type)
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_post: Post = serde_json::from_slice(&body).expect("Failed to deserialize image post");

    assert_eq!(created_post.content, post_content);
    assert_eq!(created_post.images.len(), 1);
    // URL is generated, check prefix and suffix
    // Use test base url from helper
    let expected_url_prefix = format!("{}/", "/test_images"); // Match helper config
    assert!(created_post.images[0].image_url.starts_with(&expected_url_prefix), "URL: {} did not start with {}", created_post.images[0].image_url, expected_url_prefix);
    assert!(created_post.images[0].image_url.ends_with(".png"));
    assert_eq!(created_post.images[0].post_id, created_post.id);

    // Verify image file exists (using test upload dir)
    let expected_filename = created_post.images[0].image_url.split('/').last().unwrap();
    let upload_dir = "./test_uploads"; // Match helper config
    let file_path = PathBuf::from(upload_dir).join(expected_filename);
    
    // Ensure the test dir exists before checking the file
    tokio::fs::create_dir_all(upload_dir).await.ok(); 
    
    assert!(tokio::fs::try_exists(&file_path).await.unwrap_or(false), "Image file was not saved at {:?}", file_path);
    // Clean up created file and dir
    tokio::fs::remove_file(&file_path).await.ok(); 
    tokio::fs::remove_dir(upload_dir).await.ok(); // Clean up test dir
}

#[sqlx::test]
async fn test_create_post_with_quote(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Quote Test Cat").await;
    let board_id = create_test_board(&app, category_id, "Quote Test Board").await;
    let thread_id = create_test_thread(&app, board_id, "Quote Test Thread").await;
    
    // Create the first post using the helper
    let (first_post_status, first_post_body) = create_test_post(&app, thread_id, "First post content", "user1", None).await;
    assert_eq!(first_post_status, StatusCode::CREATED);
    let first_post: Post = serde_json::from_slice(&first_post_body).expect("Failed to parse first post");
    let first_post_id = first_post.id;

    let quote_content = "Replying to the first post";
    let author_id = "user2";

    // Create the quoting post using multipart
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();

    // author_id
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"author_id\"\r\n\r\n");
    body_bytes.extend_from_slice(author_id.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");

    // content
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body_bytes.extend_from_slice(quote_content.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");
    
    // quote_of
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"quote_of\"\r\n\r\n");
    body_bytes.extend_from_slice(first_post_id.to_string().as_bytes()); // Use the actual ID
    body_bytes.extend_from_slice(b"\r\n");

    // closing boundary
    body_bytes.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    let content_type = format!("multipart/form-data; boundary={}", boundary);

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, content_type)
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_post: Post = serde_json::from_slice(&body).expect("Failed to deserialize quoting post");

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

    let (status, _) = create_test_post(&app, non_existent_thread_id, "content", "author", None).await;

    assert_eq!(status, StatusCode::NOT_FOUND); // Handler should return NOT_FOUND before creating
}

#[sqlx::test]
async fn test_create_post_invalid_quote(pool: PgPool) {
    let app = create_test_app(pool).await;
    let category_id = create_test_category(&app, "Inv Quote Cat").await;
    let board_id = create_test_board(&app, category_id, "Inv Quote Board").await;
    let thread_id = create_test_thread(&app, board_id, "Inv Quote Thread").await;
    let non_existent_post_id = Uuid::new_v4();

    // Create multipart request directly
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();
    let author_id = "user1";
    let content = "Trying to quote nothing";

    // author_id
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"author_id\"\r\n\r\n");
    body_bytes.extend_from_slice(author_id.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");

    // content
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body_bytes.extend_from_slice(content.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");
    
    // quote_of (invalid)
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"quote_of\"\r\n\r\n");
    body_bytes.extend_from_slice(non_existent_post_id.to_string().as_bytes()); // Use the invalid ID
    body_bytes.extend_from_slice(b"\r\n");

    // closing boundary
    body_bytes.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
    
    let content_type = format!("multipart/form-data; boundary={}", boundary);

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, content_type)
                .body(Body::from(body_bytes))
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
    
    // We can't easily pass image URLs via the text-only create_test_post helper.
    // Create the post directly in the DB for this specific test case.
    let post_id = Uuid::new_v4();
    let post_content = "Post to get";
    let author_id = "user1";
    let image_url = "http://get.me/img.png";
    sqlx::query!(
        "INSERT INTO posts (id, thread_id, author_id, content) VALUES ($1, $2, $3, $4)",
        post_id, thread_id, author_id, post_content
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)",
        post_id, image_url
    )
    .execute(&pool)
    .await
    .unwrap();

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
    let fetched_post: Post = serde_json::from_slice(&fetch_body).expect("Failed to parse fetched post");

    assert_eq!(fetched_post.id, post_id);
    assert_eq!(fetched_post.content, post_content);
    assert_eq!(fetched_post.thread_id, thread_id);
    assert_eq!(fetched_post.images.len(), 1);
    assert_eq!(fetched_post.images[0].image_url, image_url);
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

    // Create 3 posts, one with an image directly in DB as helper cant handle images easily
    let (status1, body1) = create_test_post(&app, thread_id, "Post one", "userA", None).await;
    assert_eq!(status1, StatusCode::CREATED);
    let post1: Post = serde_json::from_slice(&body1).unwrap();
    let post1_id = post1.id;

    // Post 2 with image - insert directly
    let post2_id = Uuid::new_v4();
    let post2_image = "img.jpg";
    sqlx::query!("INSERT INTO posts (id, thread_id, author_id, content) VALUES ($1, $2, $3, $4)", post2_id, thread_id, "userB", "Post two with image").execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)", post2_id, post2_image).execute(&pool).await.unwrap();

    let (status3, body3) = create_test_post(&app, thread_id, "Post three", "userC", None).await;
    assert_eq!(status3, StatusCode::CREATED);
    let post3: Post = serde_json::from_slice(&body3).unwrap();
    let post3_id = post3.id;

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
    let body_page1 = response_page1.into_body().collect().await.unwrap().to_bytes();
    let posts_page1: Vec<Post> = serde_json::from_slice(&body_page1).unwrap();

    assert_eq!(posts_page1.len(), 2);
    // Order might depend on insertion timing vs ID generation; check both possibilities
    // Assuming ordered by created_at ASC (default)
    assert_eq!(posts_page1[0].id, post1_id); 
    assert!(posts_page1[0].images.is_empty());
    assert_eq!(posts_page1[1].id, post2_id);
    assert_eq!(posts_page1[1].images.len(), 1);
    assert_eq!(posts_page1[1].images[0].image_url, post2_image);

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
    let body_page2 = response_page2.into_body().collect().await.unwrap().to_bytes();
    let posts_page2: Vec<Post> = serde_json::from_slice(&body_page2).unwrap();

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
    // Check content based on expected order
    assert_eq!(posts_default[0].id, post1_id);
    assert!(posts_default[0].images.is_empty());
    assert_eq!(posts_default[1].id, post2_id);
    assert_eq!(posts_default[1].images.len(), 1);
    assert_eq!(posts_default[2].id, post3_id);
    assert!(posts_default[2].images.is_empty());
}

#[sqlx::test]
async fn test_update_post_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Update Post Cat").await;
    let board_id = create_test_board(&app, category_id, "Update Post Board").await;
    let thread_id = create_test_thread(&app, board_id, "Update Post Thread").await;
    
    // Create post directly in DB as helper doesn't handle images well
    let post_id = Uuid::new_v4();
    let original_content = "Original content";
    let author_id = "user1";
    let original_image_url = "original_image.png";
    sqlx::query!("INSERT INTO posts (id, thread_id, author_id, content) VALUES ($1, $2, $3, $4)", post_id, thread_id, author_id, original_content).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)", post_id, original_image_url).execute(&pool).await.unwrap();


    let updated_content = "This content has been edited.";

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/posts/{}", post_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "content": updated_content }).to_string())) // Update is still JSON
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let updated_post: Post = serde_json::from_slice(&body).expect("Failed to deserialize updated post");
    assert_eq!(updated_post.id, post_id);
    assert_eq!(updated_post.content, updated_content);
    assert_eq!(updated_post.thread_id, thread_id); // Check thread ID didn't change
    assert_eq!(updated_post.author_id, author_id); // Check author didn't change
    assert_eq!(updated_post.images.len(), 1);
    assert_eq!(updated_post.images[0].image_url, original_image_url);

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
    
    // Create post directly in DB
    let post_id = Uuid::new_v4();
    let post_content = "Post to Delete";
    let author_id = "user1";
    let image_url = "delete.jpg";
    sqlx::query!("INSERT INTO posts (id, thread_id, author_id, content) VALUES ($1, $2, $3, $4)", post_id, thread_id, author_id, post_content).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)", post_id, image_url).execute(&pool).await.unwrap();

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
    assert!(result.is_none(), "Post was not deleted from DB");

    // Verify associated image is gone (due to cascade)
    let image_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_images WHERE post_id = $1")
        .bind(post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(image_count, 0, "Post image was not deleted from DB");
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
    
    // Create post to be deleted directly in DB
    let post_to_delete_id = Uuid::new_v4();
    sqlx::query!("INSERT INTO posts (id, thread_id, author_id, content) VALUES ($1, $2, $3, $4)", post_to_delete_id, thread_id, "user1", "Post to be quoted and deleted").execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)", post_to_delete_id, "deleted.png").execute(&pool).await.unwrap();


    // Create the quoting post directly in DB (with its own image)
    let quoting_post_id = Uuid::new_v4();
    let quoting_image_url = "quoting.gif";
    sqlx::query!(
        "INSERT INTO posts (id, thread_id, author_id, content, quote_of) VALUES ($1, $2, $3, $4, $5)",
        quoting_post_id,
        thread_id,
        "user2",
        "I am quoting a post that will be deleted",
        post_to_delete_id // Quote the first post
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
    let quoting_post_full = forum_server::repositories::post_repository::get_post_by_id(&pool, quoting_post_id).await.unwrap().expect("Quoting post deleted unexpectedly");

    assert!(quoting_post_full.quote_of.is_none(), "quote_of was not set to NULL");
    // Verify quoting post's image is still there
    assert_eq!(quoting_post_full.images.len(), 1);
    assert_eq!(quoting_post_full.images[0].image_url, quoting_image_url);
}

#[sqlx::test]
async fn test_create_post_too_many_images(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Too Many Img Cat").await;
    let board_id = create_test_board(&app, category_id, "Too Many Img Board").await;
    let thread_id = create_test_thread(&app, board_id, "Too Many Img Thread").await;

    let post_content = "This post has too many images!";
    let author_id = "user_many_img";
    let max_images = 5; // Should match constant in handler
    
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();

    // Add text fields
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"author_id\"\r\n\r\n");
    body_bytes.extend_from_slice(author_id.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body_bytes.extend_from_slice(post_content.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"quote_of\"\r\n\r\n");
    body_bytes.extend_from_slice(b"");
    body_bytes.extend_from_slice(b"\r\n");

    // Add more images than allowed
    for i in 0..=(max_images) { // Add max_images + 1 images
        let image_filename = format!("test_image_{}.jpg", i);
        let image_content_type = mime::IMAGE_JPEG;
        let image_bytes = Bytes::from_static(b"fake_jpeg");

        body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body_bytes.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"image\"; filename=\"{}\"\r\n",
                image_filename
            )
            .as_bytes(),
        );
        body_bytes.extend_from_slice(format!("Content-Type: {}\r\n\r\n", image_content_type).as_bytes());
        body_bytes.extend_from_slice(&image_bytes);
        body_bytes.extend_from_slice(b"\r\n");
    }

    // Add closing boundary
    body_bytes.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    let content_type = format!("multipart/form-data; boundary={}", boundary);

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, content_type)
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    // Expect BAD_REQUEST because the image count limit is checked first
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let error_message = String::from_utf8_lossy(&body);
    assert!(error_message.contains(&format!("Exceeded maximum number of images ({})", max_images)));
}

#[sqlx::test]
async fn test_create_post_image_too_large(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let category_id = create_test_category(&app, "Large Img Cat").await;
    let board_id = create_test_board(&app, category_id, "Large Img Board").await;
    let thread_id = create_test_thread(&app, board_id, "Large Img Thread").await;

    let post_content = "This post has a large image!";
    let author_id = "user_large_img";
    let max_image_size_mb = 10; // Should match constant in handler
    let max_image_size_bytes = max_image_size_mb * 1024 * 1024;
    
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();

    // Add text fields
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"author_id\"\r\n\r\n");
    body_bytes.extend_from_slice(author_id.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    body_bytes.extend_from_slice(post_content.as_bytes());
    body_bytes.extend_from_slice(b"\r\n");
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"quote_of\"\r\n\r\n");
    body_bytes.extend_from_slice(b"");
    body_bytes.extend_from_slice(b"\r\n");

    // Add one large image field
    let image_filename = "large_image.bin";
    let image_content_type = mime::APPLICATION_OCTET_STREAM;
    // Create fake data slightly larger than the limit
    let image_data: Vec<u8> = vec![0; max_image_size_bytes + 1]; 
    let image_bytes = Bytes::from(image_data);

    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body_bytes.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"image\"; filename=\"{}\"\r\n",
            image_filename
        )
        .as_bytes(),
    );
    body_bytes.extend_from_slice(format!("Content-Type: {}\r\n\r\n", image_content_type).as_bytes());
    body_bytes.extend_from_slice(&image_bytes);
    body_bytes.extend_from_slice(b"\r\n");

    // Add closing boundary
    body_bytes.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    let content_type = format!("multipart/form-data; boundary={}", boundary);

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, content_type)
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    // Expect BAD_REQUEST because the internal multipart parsing fails before our size check
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let error_message = String::from_utf8_lossy(&body);
    // Check for the generic parsing error message
    assert!(error_message.contains("Multipart parsing error"), "Expected parsing error, got: {}", error_message);
}

// TODO: Add test for unauthorized delete attempt later 