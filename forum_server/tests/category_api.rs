// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, HeaderName, Request, StatusCode},
};
use forum_server::{
    models::Category, // Assuming models are public in lib.rs or main.rs
};
use http_body_util::BodyExt; // for `collect`
use serde_json::json; // For creating JSON body easily in tests
use sqlx::PgPool;
use tower::ServiceExt; // for `oneshot`
use uuid::Uuid;

// Bring helpers into scope
use common::helpers::{
    create_test_app, create_test_category, generate_test_keypair, get_auth_headers,
};

// Helper function to create the Axum app with a test database connection
// This assumes you have configured sqlx::test correctly (e.g., DATABASE_URL set)
// and might require modifications in main.rs or creating a lib.rs.
// For now, we'll define a placeholder function `create_test_app`.
// NOTE: Setting up testing with Axum state and sqlx::test can be involved.
// This is a simplified example.

#[sqlx::test]
async fn test_create_category_success(pool: PgPool) {
    // Setup admin user
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await; // Pass admin key

    // Use helper which now requires admin keypair
    let category_name = "Admin Category";
    let category_id = create_test_category(&app, category_name, &admin_keypair).await;

    // Verify directly in the database
    let saved_category = sqlx::query_as::<_, Category>("SELECT * FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_one(&pool)
        .await
        .expect("Failed to fetch category from test DB");

    assert_eq!(saved_category.id, category_id);
    assert_eq!(saved_category.name, category_name);
}

#[sqlx::test]
async fn test_create_category_unauthorized(pool: PgPool) {
    // Setup non-admin user and empty admin set in app
    let non_admin_keypair = generate_test_keypair();
    let app = create_test_app(pool.clone(), None).await; // No admins configured
    let auth_headers = get_auth_headers(&app, &non_admin_keypair).await;

    let category_name = "Unauthorized Category";
    let category_desc = "This should fail";

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/categories")
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                // Add non-admin auth headers
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
                    json!({ "name": category_name, "description": category_desc }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Expect Forbidden (or Unauthorized depending on AuthError mapping in AdminUser)
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED); // Or FORBIDDEN if AuthError is updated
}

#[sqlx::test]
async fn test_get_category_success(pool: PgPool) {
    // Setup admin user for creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;

    // Create category using helper (requires admin)
    let category_id = create_test_category(&app, "Fetch Me", &admin_keypair).await;

    // Fetch without auth headers
    let fetch_response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/categories/{}", category_id))
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
    let fetched_category: Category =
        serde_json::from_slice(&fetch_body).expect("Failed to deserialize fetched category");
    assert_eq!(fetched_category.id, category_id);
    assert_eq!(fetched_category.name, "Fetch Me");
}

#[sqlx::test]
async fn test_get_category_not_found(pool: PgPool) {
    let app = create_test_app(pool.clone(), None).await; // No admin needed
    let non_existent_id = Uuid::new_v4();
    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri(format!("/categories/{}", non_existent_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_list_categories_pagination(pool: PgPool) {
    // Setup admin user for creation
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;

    // Create 3 categories (requires admin)
    let cat1_id = create_test_category(&app, "Cat 1", &admin_keypair).await;
    let cat2_id = create_test_category(&app, "Cat 2", &admin_keypair).await;
    let cat3_id = create_test_category(&app, "Cat 3", &admin_keypair).await;

    // Fetch first page (limit 2, offset 0)
    let response_page1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/categories?limit=2&offset=0")
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
    let categories_page1: Vec<Category> = serde_json::from_slice(&body1).unwrap();

    assert_eq!(categories_page1.len(), 2);
    // Assert based on ascending order assigned during creation
    assert_eq!(categories_page1[0].id, cat1_id); // Cat 1 has order 0
    assert_eq!(categories_page1[1].id, cat2_id); // Cat 2 has order 1

    // Fetch second page (limit 2, offset 2)
    let response_page2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/categories?limit=2&offset=2")
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
    let categories_page2: Vec<Category> = serde_json::from_slice(&body2).unwrap();

    assert_eq!(categories_page2.len(), 1);
    // Assert based on ascending order
    assert_eq!(categories_page2[0].id, cat3_id); // Cat 3 has order 2

    // Test default limit
    let response_default = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/categories")
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
    let categories_default: Vec<Category> = serde_json::from_slice(&body_default).unwrap();
    // Default limit is 25, we created 3, so we should get 3 back
    assert_eq!(categories_default.len(), 3);
    // Optional: Assert order for default limit if needed
    assert_eq!(categories_default[0].id, cat1_id);
    assert_eq!(categories_default[1].id, cat2_id);
    assert_eq!(categories_default[2].id, cat3_id);
}

#[sqlx::test]
async fn test_update_category_success(pool: PgPool) {
    // Setup admin user
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;

    // Create category using helper (requires admin)
    let category_id = create_test_category(&app, "To Update", &admin_keypair).await;

    let updated_name = "Updated Category Name";
    let updated_desc = "This description has been updated.";

    // Send PUT request with admin auth
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/categories/{}", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                // Add admin auth headers
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
                        "name": updated_name,
                        "description": updated_desc
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Check response body
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let updated_category: Category = serde_json::from_slice(&body).unwrap();
    assert_eq!(updated_category.id, category_id);
    assert_eq!(updated_category.name, updated_name);
    assert_eq!(updated_category.description, updated_desc);

    // Verify directly in DB
    let saved_category = sqlx::query_as::<_, Category>("SELECT * FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saved_category.name, updated_name);
    assert_eq!(saved_category.description, updated_desc);
}

#[sqlx::test]
async fn test_update_category_unauthorized(pool: PgPool) {
    // Setup admin for creation, non-admin for update attempt
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let non_admin_keypair = generate_test_keypair();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Update Auth Test", &admin_keypair).await;
    let non_admin_auth_headers = get_auth_headers(&app, &non_admin_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/categories/{}", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                // Use non-admin auth headers
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
                    json!({
                        "name": "Fail Update",
                        "description": "Should Fail"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED); // Or FORBIDDEN
}

#[sqlx::test]
async fn test_update_category_not_found(pool: PgPool) {
    // Setup admin user (required for the endpoint)
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let non_existent_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/categories/{}", non_existent_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                // Add admin auth headers (auth passes, but ID is bad)
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
async fn test_delete_category_success(pool: PgPool) {
    // Setup admin user
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;

    // Create category using helper (requires admin)
    let category_id = create_test_category(&app, "To Delete", &admin_keypair).await;

    // Send DELETE request with admin auth
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/categories/{}", category_id))
                // Add admin auth headers
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

    // Verify directly in DB that it's gone
    let result = sqlx::query("SELECT 1 FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(result.is_none());
}

#[sqlx::test]
async fn test_delete_category_unauthorized(pool: PgPool) {
    // Setup admin for creation, non-admin for delete attempt
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let non_admin_keypair = generate_test_keypair();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let category_id = create_test_category(&app, "Delete Auth Test", &admin_keypair).await;
    let non_admin_auth_headers = get_auth_headers(&app, &non_admin_keypair).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/categories/{}", category_id))
                // Use non-admin auth headers
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

    // Verify category still exists
    let result = sqlx::query("SELECT 1 FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(result.is_some());
}

#[sqlx::test]
async fn test_delete_category_not_found(pool: PgPool) {
    // Setup admin user (required for the endpoint)
    let admin_keypair = generate_test_keypair();
    let admin_pubkey = admin_keypair.verifying_key().to_bytes().to_vec();
    let app = create_test_app(pool.clone(), Some(vec![admin_pubkey])).await;
    let auth_headers = get_auth_headers(&app, &admin_keypair).await;
    let non_existent_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/categories/{}", non_existent_id))
                // Add admin auth headers (auth passes, but ID is bad)
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

// TODO: Add tests for error cases (e.g., invalid UUID format in path)

// TODO: Add tests for error cases (e.g., invalid payload, database errors)
