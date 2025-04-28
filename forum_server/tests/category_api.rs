// Declare the common module
mod common;

use axum::{
    body::Body,
    http::{self, Request, StatusCode},
};
use forum_server::{
    models::Category, // Assuming models are public in lib.rs or main.rs
};
use http_body_util::BodyExt; // for `collect`
use sqlx::PgPool;
use tower::ServiceExt; // for `oneshot`
use serde_json::json; // For creating JSON body easily in tests
use uuid::Uuid;

// Bring helpers into scope
use common::helpers::{create_test_app, create_test_category};

// Helper function to create the Axum app with a test database connection
// This assumes you have configured sqlx::test correctly (e.g., DATABASE_URL set)
// and might require modifications in main.rs or creating a lib.rs.
// For now, we'll define a placeholder function `create_test_app`.
// NOTE: Setting up testing with Axum state and sqlx::test can be involved.
// This is a simplified example.

#[sqlx::test]
async fn test_create_category_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;

    let category_name = "Test Category";
    let category_desc = "A category created during testing";

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/categories")
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(
                    format!(
                        r#"{{"name": "{}", "description": "{}"}} "#,
                        category_name,
                        category_desc
                    )
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let created_category: Category = serde_json::from_slice(&body).expect("Failed to deserialize response body");

    assert_eq!(created_category.name, category_name);
    assert_eq!(created_category.description, category_desc);

    // Optional: Verify directly in the database
    let saved_category = sqlx::query_as::<_, Category>("SELECT * FROM categories WHERE id = $1")
        .bind(created_category.id)
        .fetch_one(&pool)
        .await
        .expect("Failed to fetch category from test DB");

    assert_eq!(saved_category.id, created_category.id);
    assert_eq!(saved_category.name, category_name);
}

#[sqlx::test]
async fn test_get_category_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;

    // Create category using helper
    let category_id = create_test_category(&app, "Fetch Me").await;

    // 2. Try to fetch the created category
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

    let fetch_body = fetch_response.into_body().collect().await.unwrap().to_bytes();
    let fetched_category: Category = serde_json::from_slice(&fetch_body)
        .expect("Failed to deserialize fetched category");

    assert_eq!(fetched_category.id, category_id);
    assert_eq!(fetched_category.name, "Fetch Me");
    assert_eq!(fetched_category.description, "...");
}

#[sqlx::test]
async fn test_get_category_not_found(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    let non_existent_id = Uuid::new_v4(); // Generate a random UUID

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
    let app = create_test_app(pool.clone()).await;

    // Create 3 categories
    let cat1_id = create_test_category(&app, "Cat 1").await;
    let cat2_id = create_test_category(&app, "Cat 2").await;
    let cat3_id = create_test_category(&app, "Cat 3").await;

    // Fetch first page (limit 2, offset 0)
    let response_page1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/categories?limit=2&offset=0") // Add query params
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response_page1.status(), StatusCode::OK);
    let body1 = response_page1.into_body().collect().await.unwrap().to_bytes();
    let categories_page1: Vec<Category> = serde_json::from_slice(&body1).unwrap();

    assert_eq!(categories_page1.len(), 2);
    // Categories ordered by creation DESC, so Cat 3 should be first
    assert_eq!(categories_page1[0].id, cat3_id);
    assert_eq!(categories_page1[1].id, cat2_id);

    // Fetch second page (limit 2, offset 2)
    let response_page2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/categories?limit=2&offset=2") // Add query params
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response_page2.status(), StatusCode::OK);
    let body2 = response_page2.into_body().collect().await.unwrap().to_bytes();
    let categories_page2: Vec<Category> = serde_json::from_slice(&body2).unwrap();

    assert_eq!(categories_page2.len(), 1);
    assert_eq!(categories_page2[0].id, cat1_id);

    // Test default limit - URI with NO query params
    let response_default = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/categories") // Use URI without explicit params
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_default.status(), StatusCode::OK);
    let body_default = response_default.into_body().collect().await.unwrap().to_bytes();
    let categories_default: Vec<Category> = serde_json::from_slice(&body_default).unwrap();
    // Default limit is 25, we created 3, so we should get 3 back
    assert_eq!(categories_default.len(), 3);
}

#[sqlx::test]
async fn test_update_category_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    // Use helper to create initial category
    let category_id = create_test_category(&app, "To Update").await;

    let updated_name = "Updated Category Name";
    let updated_desc = "This description has been updated.";

    // Send PUT request
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/categories/{}", category_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
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
async fn test_update_category_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/categories/{}", non_existent_id))
                .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                .body(Body::from(json!({ "name": "n", "description": "d" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn test_delete_category_success(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;
    // Use helper to create initial category
    let category_id = create_test_category(&app, "To Delete").await;

    // Send DELETE request
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/categories/{}", category_id))
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

    // Optional: Verify cascade delete if applicable later
}

#[sqlx::test]
async fn test_delete_category_not_found(pool: PgPool) {
    let app = create_test_app(pool).await;
    let non_existent_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/categories/{}", non_existent_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

// TODO: Add tests for error cases (e.g., invalid UUID format in path)

// TODO: Add tests for error cases (e.g., invalid payload, database errors) 