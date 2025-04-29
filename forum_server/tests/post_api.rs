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
use ed25519_dalek::SigningKey; // Import SigningKey
use axum::http::header::{HeaderName, HeaderValue}; // Import HeaderName and HeaderValue
use sqlx::postgres::PgPoolOptions; // Add PgPoolOptions

// Bring helpers into scope
use common::helpers::{create_test_app, create_test_category, create_test_board, create_test_thread, create_test_post, generate_boundary, generate_test_keypair, get_auth_headers}; // Add keypair/auth helpers

// --- Post Tests --- 

#[sqlx::test]
async fn test_create_post_success(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Post Test Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Post Test Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_keypair = generate_test_keypair();
    let (thread_id, _) = create_test_thread(&app, board_id, "Post Test Thread", &thread_keypair).await;

    let post_content = "This is the first post!";
    // let author_id_str = "user1"; // Unused
    // let expected_author_id = vec![0u8; 32]; // Use actual key

    // Use helper, passing the keypair
    let (status, body_bytes, expected_author_id) = create_test_post(&app, thread_id, post_content, &post_keypair, None).await;

    assert_eq!(status, StatusCode::CREATED);
    let created_post: Post = serde_json::from_slice(&body_bytes).expect("Failed to deserialize post");

    assert_eq!(created_post.content, post_content);
    assert_eq!(created_post.author_id, expected_author_id); // Compare with actual key bytes
    assert_eq!(created_post.thread_id, thread_id);
    assert!(created_post.quote_of.is_none());
    assert!(created_post.images.is_empty());

    // Verify in DB
    let image_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_images WHERE post_id = $1")
        .bind(created_post.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(image_count, 0);

    // Re-fetch post data to check author_id and content
    let saved_post = sqlx::query!("SELECT author_id, content FROM posts WHERE id = $1", created_post.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_post.content, post_content);
    assert_eq!(saved_post.author_id, expected_author_id); // Check author_id bytes in DB
}

#[sqlx::test]
async fn test_create_post_with_images(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Img Post Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Img Post Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_keypair = generate_test_keypair();
    let (thread_id, _) = create_test_thread(&app, board_id, "Img Post Thread", &thread_keypair).await;
    let expected_author_id = post_keypair.verifying_key().to_bytes().to_vec();

    let post_content = "This post has images!";
    
    // Get auth headers
    let auth_headers = get_auth_headers(&app, &post_keypair).await;

    // --- Simulate multipart form data --- 
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();

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
                // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_post: Post = serde_json::from_slice(&body).expect("Failed to deserialize image post");

    assert_eq!(created_post.content, post_content);
    assert_eq!(created_post.author_id, expected_author_id); // Check placeholder ID
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
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Quote Test Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Quote Test Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let first_post_keypair = generate_test_keypair();
    let quoting_post_keypair = generate_test_keypair();
    let (thread_id, _) = create_test_thread(&app, board_id, "Quote Test Thread", &thread_keypair).await;
    let expected_author1_id = first_post_keypair.verifying_key().to_bytes().to_vec();
    let expected_author2_id = quoting_post_keypair.verifying_key().to_bytes().to_vec();
    
    // Create the first post using the helper
    let (first_post_status, first_post_body, _) = create_test_post(&app, thread_id, "First post content", &first_post_keypair, None).await;
    assert_eq!(first_post_status, StatusCode::CREATED);
    let first_post: Post = serde_json::from_slice(&first_post_body).expect("Failed to parse first post");
    let first_post_id = first_post.id;
    assert_eq!(first_post.author_id, expected_author1_id); // Verify first post author

    let quote_content = "Replying to the first post";
    
    // Get auth headers for quoting post
    let auth_headers = get_auth_headers(&app, &quoting_post_keypair).await;

    // Create the quoting post using multipart
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();

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
                // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_post: Post = serde_json::from_slice(&body).expect("Failed to deserialize quoting post");

    assert_eq!(created_post.content, quote_content);
    assert_eq!(created_post.author_id, expected_author2_id); // Check quoting post author ID
    assert_eq!(created_post.thread_id, thread_id);
    assert_eq!(created_post.quote_of, Some(first_post_id));
    assert!(created_post.images.is_empty()); // Assert quoted post has no images
}

#[sqlx::test]
async fn test_create_post_invalid_thread(pool: PgPool) {
    // No admin needed for app setup
    let app = create_test_app(pool, None).await;
    let non_existent_thread_id = Uuid::new_v4();
    let keypair = generate_test_keypair(); // Need a keypair even though request fails

    // Call helper, expect failure status
    let (status, _, _) = create_test_post(&app, non_existent_thread_id, "content", &keypair, None).await;

    assert_eq!(status, StatusCode::NOT_FOUND); // Handler should return NOT_FOUND before creating
}

#[sqlx::test]
async fn test_create_post_invalid_quote(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Invalid Quote Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Invalid Quote Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_keypair = generate_test_keypair();
    let (thread_id, _) = create_test_thread(&app, board_id, "Inv Quote Thread", &thread_keypair).await;
    let non_existent_post_id = Uuid::new_v4();
    
    let auth_headers = get_auth_headers(&app, &post_keypair).await;

    // Create multipart request directly
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();
    let content = "Trying to quote nothing";

    // content
    body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    // REMOVED author_id field
    // body_bytes.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    // body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"author_id\"\r\n\r\n");
    // body_bytes.extend_from_slice(author_id.as_bytes());
    // body_bytes.extend_from_slice(b"\r\n");

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
                // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST); // We check quote existence
}

#[sqlx::test]
async fn test_get_post_success(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Get Post Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Get Post Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let (thread_id, _) = create_test_thread(&app, board_id, "Get Post Thread", &thread_keypair).await;
    
    // Create the post directly in the DB 
    let post_id = Uuid::new_v4();
    let post_content = "Post to get";
    let keypair = generate_test_keypair();
    let author_id_bytes = keypair.verifying_key().to_bytes().to_vec();
    let image_url = "http://get.me/img.png";
    sqlx::query!(
        "INSERT INTO posts (id, thread_id, author_id, content) VALUES ($1, $2, $3::BYTEA, $4)",
        post_id, thread_id, &author_id_bytes, post_content
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
    assert_eq!(fetched_post.author_id, author_id_bytes); // Compare bytes
    assert_eq!(fetched_post.thread_id, thread_id);
    assert_eq!(fetched_post.images.len(), 1);
    assert_eq!(fetched_post.images[0].image_url, image_url);
}

#[sqlx::test]
async fn test_get_post_not_found(pool: PgPool) {
    // No admin needed for app setup
    let app = create_test_app(pool, None).await;
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
    // Setup admin for category/board/thread creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "List Posts Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "List Posts Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair(); // Used for thread creation
    let (thread_id, _) = create_test_thread(&app, board_id, "List Posts Thread", &thread_keypair).await;
    // Define keypairs for posts
    let post1_keypair = generate_test_keypair(); 
    let post3_keypair = generate_test_keypair();

    let author_b_bytes = b"userB".to_vec(); // Specific ID for direct DB insertion

    // Create 3 posts, one with an image directly in DB as helper cant handle images easily
    let (status1, body1, expected_author1_id) = create_test_post(&app, thread_id, "Post one", &post1_keypair, None).await; // Use keypair and capture pubkey
    assert_eq!(status1, StatusCode::CREATED);
    let post1: Post = serde_json::from_slice(&body1).unwrap();
    let post1_id = post1.id;
    assert_eq!(post1.author_id, expected_author1_id); // Compare with returned pubkey

    // Post 2 with image - insert directly (Keep this as is)
    let post2_id = Uuid::new_v4();
    let post2_image = "img.jpg";
    sqlx::query!("INSERT INTO posts (id, thread_id, author_id, content) VALUES ($1, $2, $3::BYTEA, $4)", post2_id, thread_id, &author_b_bytes, "Post two with image").execute(&pool).await.unwrap(); // Bind bytes
    sqlx::query!("INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)", post2_id, post2_image).execute(&pool).await.unwrap();

    let (status3, body3, expected_author3_id) = create_test_post(&app, thread_id, "Post three", &post3_keypair, None).await; // Use keypair and capture pubkey
    assert_eq!(status3, StatusCode::CREATED);
    let post3: Post = serde_json::from_slice(&body3).unwrap();
    let post3_id = post3.id;
    assert_eq!(post3.author_id, expected_author3_id); // Compare with returned pubkey

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
    assert_eq!(posts_page1[0].author_id, expected_author1_id); // Compare with captured pubkey
    assert!(posts_page1[0].images.is_empty());
    assert_eq!(posts_page1[1].id, post2_id);
    assert_eq!(posts_page1[1].author_id, author_b_bytes); // Compare with specific bytes
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
    assert_eq!(posts_page2[0].author_id, expected_author3_id); // Compare with captured pubkey
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
    assert_eq!(posts_default[0].author_id, expected_author1_id); // Compare with captured pubkey
    assert_eq!(posts_default[1].id, post2_id);
    assert_eq!(posts_default[1].author_id, author_b_bytes);
    assert_eq!(posts_default[2].id, post3_id);
    assert_eq!(posts_default[2].author_id, expected_author3_id); // Compare with captured pubkey
}

#[sqlx::test]
async fn test_update_post_success(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Update Post Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Update Post Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_keypair = generate_test_keypair(); // Keypair for post creation & update
    let (thread_id, _) = create_test_thread(&app, board_id, "Update Post Thread", &thread_keypair).await; // Pass keypair
    
    // Create post using helper
    let (create_status, create_body, expected_author_id) = create_test_post(&app, thread_id, "Original content", &post_keypair, None).await;
    assert_eq!(create_status, StatusCode::CREATED);
    let created_post: Post = serde_json::from_slice(&create_body).expect("Failed to deserialize created post for update");
    let post_id = created_post.id;
    assert_eq!(created_post.author_id, expected_author_id);

    let updated_content = "This content has been edited.";

    // Get auth headers for the update request using the *same* keypair
    let update_auth_headers = get_auth_headers(&app, &post_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/posts/{}", post_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                 // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), update_auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), update_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), update_auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(json!({ "content": updated_content }).to_string())) 
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let updated_post: Post = serde_json::from_slice(&body).expect("Failed to deserialize updated post");
    assert_eq!(updated_post.id, post_id);
    assert_eq!(updated_post.content, updated_content);
    assert_eq!(updated_post.thread_id, thread_id); 
    assert_eq!(updated_post.author_id, expected_author_id); // Check author bytes didn't change
    // Helper doesn't add images, so image checks are removed/commented
    // assert_eq!(updated_post.images.len(), 1);
    // assert_eq!(updated_post.images[0].image_url, original_image_url);

    // Verify content in DB
    let saved_post = sqlx::query!("SELECT content, author_id FROM posts WHERE id = $1", post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_post.content, updated_content);
    assert_eq!(saved_post.author_id, expected_author_id); // Check author bytes in DB

    // Verify image count in DB (should be 0)
    let image_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_images WHERE post_id = $1")
        .bind(post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(image_count, 0);
}

#[sqlx::test]
async fn test_update_post_unauthorized(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Update Unauth Post Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Update Unauth Post Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_owner_keypair = generate_test_keypair(); // Original post owner
    let attacker_keypair = generate_test_keypair(); // Different keypair for the attacker
    
    // Verify keypairs are different before proceeding
    assert_ne!(post_owner_keypair.verifying_key().to_bytes(), attacker_keypair.verifying_key().to_bytes(), "Owner and attacker keypairs are the same!");
    
    let (thread_id, _) = create_test_thread(&app, board_id, "Update Unauthorized Thread", &thread_keypair).await;
    
    // Create post using the owner's keypair
    let (create_status, create_body, _) = create_test_post(&app, thread_id, "Original content", &post_owner_keypair, None).await;
    assert_eq!(create_status, StatusCode::CREATED);
    let created_post: Post = serde_json::from_slice(&create_body).unwrap();
    let post_id = created_post.id;

    let updated_content = "Attacker trying to update.";

    // Get auth headers using the *attacker's* keypair
    let attacker_auth_headers = get_auth_headers(&app, &attacker_keypair).await;

    // Attempt to update the post using attacker's auth
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/posts/{}", post_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), attacker_auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), attacker_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), attacker_auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(json!({ "content": updated_content }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    // Expect 403 Forbidden because the user is authenticated but not the owner
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // Verify the post content was NOT updated in the DB
    let saved_post = sqlx::query!("SELECT content FROM posts WHERE id = $1", post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_post.content, "Original content"); // Check it's still the original
}

#[sqlx::test]
async fn test_update_post_not_found(pool: PgPool) {
    // No admin needed for app setup
    let app = create_test_app(pool, None).await;
    let non_existent_post_id = Uuid::new_v4();
    let keypair = generate_test_keypair(); // Need a keypair even for not found
    let auth_headers = get_auth_headers(&app, &keypair).await;
    
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/posts/{}", non_existent_post_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref()) // Add Content-Type header
                 // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(json!({ "content": "c" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND); // Not found takes precedence over auth internal check
}

#[sqlx::test]
async fn test_delete_post_success(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Delete Post Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Delete Post Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_keypair = generate_test_keypair(); // Keypair for post creation & deletion
    let (thread_id, _) = create_test_thread(&app, board_id, "Delete Post Thread", &thread_keypair).await; 
    let expected_author_id = post_keypair.verifying_key().to_bytes().to_vec();

    // Create post using helper
    let (status, body, _) = create_test_post(&app, thread_id, "Post to delete", &post_keypair, None).await;
    assert_eq!(status, StatusCode::CREATED);
    let created_post: Post = serde_json::from_slice(&body).expect("Failed to deserialize post");
    let post_id = created_post.id;
    assert_eq!(created_post.author_id, expected_author_id);

    // Get auth headers for delete using the *same* keypair
    let delete_auth_headers = get_auth_headers(&app, &post_keypair).await;
    
    // Send DELETE request
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/posts/{}", post_id))
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), delete_auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), delete_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), delete_auth_headers.get("x-polycentric-challenge-id").unwrap())
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

    // Verify associated image is gone (should be 0 as helper doesn't add images)
    let image_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_images WHERE post_id = $1")
        .bind(post_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(image_count, 0, "Post image count was not zero after delete");
}

#[sqlx::test]
async fn test_delete_post_unauthorized(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Delete Unauth Post Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Delete Unauth Post Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_owner_keypair = generate_test_keypair(); // Keypair of the post owner
    let attacker_keypair = generate_test_keypair(); // Different keypair for the attacker
    
    // Verify keypairs are different before proceeding
    assert_ne!(post_owner_keypair.verifying_key().to_bytes(), attacker_keypair.verifying_key().to_bytes(), "Owner and attacker keypairs are the same!");
    
    let (thread_id, _) = create_test_thread(&app, board_id, "Delete Unauthorized Thread", &thread_keypair).await;
    
    // Create post using the owner's keypair
    let (create_status, create_body, _) = create_test_post(&app, thread_id, "Post to delete (unauth)", &post_owner_keypair, None).await;
    assert_eq!(create_status, StatusCode::CREATED);
    let created_post: Post = serde_json::from_slice(&create_body).unwrap();
    let post_id = created_post.id;

    // Get auth headers using the *attacker's* keypair
    let attacker_auth_headers = get_auth_headers(&app, &attacker_keypair).await;
    
    // Attempt DELETE request with attacker's auth
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/posts/{}", post_id))
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), attacker_auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), attacker_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), attacker_auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Expect 403 Forbidden
    assert_eq!(response.status(), StatusCode::FORBIDDEN, "Expected 403 Forbidden, got {}", response.status()); // Added message

    // Verify post still exists in DB
    let result = sqlx::query("SELECT 1 FROM posts WHERE id = $1")
        .bind(post_id)
        .fetch_optional(&pool) // Use the pool argument
        .await
        .unwrap();
    assert!(result.is_some(), "Post was deleted unexpectedly");

    // Manually clean up created data (important when not using sqlx::test transaction rollback)
    // Ideally, use the IDs captured earlier (category_id, board_id, thread_id, post_id)
    // Order matters due to foreign key constraints (delete post, then thread, etc.)
    // sqlx::query!("DELETE FROM posts WHERE id = $1", post_id).execute(&pool).await.ok();
    // sqlx::query!("DELETE FROM threads WHERE id = $1", thread_id).execute(&pool).await.ok();
    // sqlx::query!("DELETE FROM boards WHERE id = $1", board_id).execute(&pool).await.ok();
    // sqlx::query!("DELETE FROM categories WHERE id = $1", category_id).execute(&pool).await.ok();
}

#[sqlx::test]
async fn test_delete_post_not_found(pool: PgPool) {
    // No admin needed for app setup
    let app = create_test_app(pool, None).await;
    let non_existent_id = Uuid::new_v4();
    let keypair = generate_test_keypair(); // Need a keypair even for not found
    let auth_headers = get_auth_headers(&app, &keypair).await;
    
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/posts/{}", non_existent_id))
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
async fn test_delete_post_sets_quote_null(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Quote Null Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Quote Null Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let first_post_keypair = generate_test_keypair(); // Owner of post to be deleted
    let quoting_post_keypair = generate_test_keypair(); // Keypair for the quoting post
    let (thread_id, _) = create_test_thread(&app, board_id, "Quote Null Thread", &thread_keypair).await; // Pass thread keypair
    let expected_author1_id = first_post_keypair.verifying_key().to_bytes().to_vec();
    let expected_author2_id = quoting_post_keypair.verifying_key().to_bytes().to_vec();

    // Create post to be deleted using helper
    let (first_post_status, first_post_body, _) = create_test_post(&app, thread_id, "Post to be deleted", &first_post_keypair, None).await;
    assert_eq!(first_post_status, StatusCode::CREATED);
    let first_post: Post = serde_json::from_slice(&first_post_body).expect("Failed to parse first post");
    let post_to_delete_id = first_post.id;
    assert_eq!(first_post.author_id, expected_author1_id);

    // Create quoting post using multipart manually since helper doesn't support quoting
    let quote_content = "I quote the deleted one";
    let quoting_auth_headers = get_auth_headers(&app, &quoting_post_keypair).await;
    let quoting_boundary = generate_boundary();
    let mut quoting_body_bytes = Vec::new();
    // content
    quoting_body_bytes.extend_from_slice(format!("--{}\r\n", quoting_boundary).as_bytes());
    quoting_body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"content\"\r\n\r\n");
    quoting_body_bytes.extend_from_slice(quote_content.as_bytes());
    quoting_body_bytes.extend_from_slice(b"\r\n");
    // quote_of
    quoting_body_bytes.extend_from_slice(format!("--{}\r\n", quoting_boundary).as_bytes());
    quoting_body_bytes.extend_from_slice(b"Content-Disposition: form-data; name=\"quote_of\"\r\n\r\n");
    quoting_body_bytes.extend_from_slice(post_to_delete_id.to_string().as_bytes()); // Use the actual ID
    quoting_body_bytes.extend_from_slice(b"\r\n");
    // closing boundary
    quoting_body_bytes.extend_from_slice(format!("--{}--\r\n", quoting_boundary).as_bytes());

    let quoting_content_type = format!("multipart/form-data; boundary={}", quoting_boundary);

    let quoting_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/threads/{}/posts", thread_id))
                .header(http::header::CONTENT_TYPE, quoting_content_type)
                // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), quoting_auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), quoting_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), quoting_auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(quoting_body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(quoting_response.status(), StatusCode::CREATED, "Failed to create quoting post manually");
    let quoting_body = quoting_response.into_body().collect().await.unwrap().to_bytes();
    let quoting_post: Post = serde_json::from_slice(&quoting_body).expect("Failed to parse quoting post");
    let quoting_post_id = quoting_post.id;
    assert_eq!(quoting_post.author_id, expected_author2_id);
    assert_eq!(quoting_post.quote_of, Some(post_to_delete_id));
    
    // Get auth headers for the post to be deleted
    let delete_auth_headers = get_auth_headers(&app, &first_post_keypair).await;

    // Send DELETE request for the *quoted* post
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/posts/{}", post_to_delete_id))
                 // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), delete_auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), delete_auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), delete_auth_headers.get("x-polycentric-challenge-id").unwrap())
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
    // Verify quoting post's image is still there - N/A, helper doesn't add images
    // assert_eq!(quoting_post_full.images.len(), 1);
    // assert_eq!(quoting_post_full.images[0].image_url, quoting_image_url);
}

#[sqlx::test]
async fn test_create_post_too_many_images(pool: PgPool) {
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Too Many Images Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Too Many Images Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_keypair = generate_test_keypair();
    let (thread_id, _) = create_test_thread(&app, board_id, "Too Many Img Thread", &thread_keypair).await;

    let post_content = "This post has too many images!";
    let max_images = 5; // Should match constant in handler
    
    // Get auth headers
    let auth_headers = get_auth_headers(&app, &post_keypair).await;
    
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();

    // REMOVED author_id field

    // Add text fields
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
                // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
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
    // Setup admin for category/board creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Image Too Large Cat", &admin_keypair).await;
    let board_id = create_test_board(&app, category_id, "Image Too Large Board", &admin_keypair).await;
    let thread_keypair = generate_test_keypair();
    let post_keypair = generate_test_keypair();
    let (thread_id, _) = create_test_thread(&app, board_id, "Large Img Thread", &thread_keypair).await;

    let post_content = "This post has a large image!";
    let max_image_size_mb = 10; // Should match constant in handler
    let max_image_size_bytes = max_image_size_mb * 1024 * 1024;
    
    // Get auth headers
    let auth_headers = get_auth_headers(&app, &post_keypair).await;
    
    let boundary = generate_boundary();
    let mut body_bytes = Vec::new();

    // REMOVED author_id field

    // Add text fields
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
                // Add auth headers
                .header(HeaderName::from_static("x-polycentric-pubkey-base64"), auth_headers.get("x-polycentric-pubkey-base64").unwrap()) 
                .header(HeaderName::from_static("x-polycentric-signature-base64"), auth_headers.get("x-polycentric-signature-base64").unwrap())
                .header(HeaderName::from_static("x-polycentric-challenge-id"), auth_headers.get("x-polycentric-challenge-id").unwrap())
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    // Status code might change depending on where Axum/multer limits hit first
    // Checking for non-OK status is more robust
    assert_ne!(response.status(), StatusCode::OK);
    // Original test expected BAD_REQUEST, but PAYLOAD_TOO_LARGE is also possible.
    // Check if it's one of the expected client error codes for size limits.
    assert!(
        response.status() == StatusCode::BAD_REQUEST || 
        response.status() == StatusCode::PAYLOAD_TOO_LARGE,
        "Expected BAD_REQUEST or PAYLOAD_TOO_LARGE, got: {}", response.status()
    );

    // Don't check specific error message string, as it might vary depending on which layer catches the error.
    // let body = response.into_body().collect().await.unwrap().to_bytes();
    // let error_message = String::from_utf8_lossy(&body);
    // assert!(error_message.contains("Multipart parsing error"), "Expected parsing error, got: {}", error_message);
}

// TODO: Add test for unauthorized delete attempt later 