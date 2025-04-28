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
async fn test_list_categories(pool: PgPool) {
    let app = create_test_app(pool.clone()).await;

    // 1. Ensure the DB is clean or create known state
    // (sqlx::test provides a clean slate, but we could clear manually if needed)

    // 2. Create a couple of categories
    let categories_to_create = vec![
        json!({ "name": "List Cat 1", "description": "First for listing" }),
        json!({ "name": "List Cat 2", "description": "Second for listing" }),
    ];

    for cat_json in categories_to_create.iter() {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(http::Method::POST)
                    .uri("/categories")
                    .header(http::header::CONTENT_TYPE, mime::APPLICATION_JSON.as_ref())
                    .body(Body::from(cat_json.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    // 3. List the categories
    let list_response = app
        .oneshot(
            Request::builder()
                .method(http::Method::GET)
                .uri("/categories")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(list_response.status(), StatusCode::OK);

    let list_body = list_response.into_body().collect().await.unwrap().to_bytes();
    let fetched_categories: Vec<Category> = serde_json::from_slice(&list_body)
        .expect("Failed to deserialize list of categories");

    // 4. Verify the results (order might matter depending on the query)
    // We ordered by created_at DESC in the query
    assert_eq!(fetched_categories.len(), 2);

    // Check the second created category (should be first in the list due to DESC order)
    assert_eq!(fetched_categories[0].name, "List Cat 2");
    assert_eq!(fetched_categories[0].description, "Second for listing");

    // Check the first created category (should be second in the list)
    assert_eq!(fetched_categories[1].name, "List Cat 1");
    assert_eq!(fetched_categories[1].description, "First for listing");
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