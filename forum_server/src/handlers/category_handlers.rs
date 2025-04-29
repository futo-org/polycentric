use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;
use crate::{
    models::Category,
    repositories::category_repository::{self, CreateCategoryData, UpdateCategoryData},
    utils::PaginationParams,
    AppState,
    auth::AdminUser,
};

/// Handler to create a new category.
/// Expects JSON body with name and description.
/// Requires Admin privileges.
pub async fn create_category_handler(
    State(state): State<AppState>,
    admin: AdminUser,
    Json(payload): Json<CreateCategoryData>,
) -> Response {
    match category_repository::create_category(&state.db_pool, payload).await {
        Ok(new_category) => {
            // Successfully created, return 201 Created with the new category
            (StatusCode::CREATED, Json(new_category)).into_response()
        }
        Err(e) => {
            eprintln!("Failed to create category: {}", e);
            // Handle specific errors maybe? For now, generic 500
            // TODO: Add better error handling (e.g., check for duplicate names?)
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create category").into_response()
        }
    }
}

/// Handler to get a single category by its ID.
pub async fn get_category_handler(
    State(state): State<AppState>,
    Path(category_id): Path<Uuid>,
) -> Response {
    match category_repository::get_category_by_id(&state.db_pool, category_id).await {
        Ok(Some(category)) => {
            // Found category, return 200 OK with the category
            (StatusCode::OK, Json(category)).into_response()
        }
        Ok(None) => {
            // Category not found, return 404 Not Found
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to fetch category: {}", e);
            // Generic error, return 500 Internal Server Error
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch category").into_response()
        }
    }
}

/// Handler to list all categories with pagination.
pub async fn list_categories_handler(
    State(state): State<AppState>,
    Query(pagination): Query<PaginationParams>,
) -> Response {
    match category_repository::get_all_categories(&state.db_pool, &pagination).await {
        Ok(categories) => {
            // Return 200 OK with the list of categories
            (StatusCode::OK, Json(categories)).into_response()
        }
        Err(e) => {
            eprintln!("Failed to fetch categories: {}", e);
            // Generic error, return 500 Internal Server Error
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch categories").into_response()
        }
    }
}

/// Handler to update a category.
/// Requires Admin privileges.
pub async fn update_category_handler(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(category_id): Path<Uuid>,
    Json(payload): Json<UpdateCategoryData>,
) -> Response {
    match category_repository::update_category(&state.db_pool, category_id, payload).await {
        Ok(Some(updated_category)) => {
            // Return 200 OK with the updated category
            (StatusCode::OK, Json(updated_category)).into_response()
        }
        Ok(None) => {
            // Category with that ID not found
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to update category: {}", e);
            // Could be constraint violation if name must be unique, etc.
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update category").into_response()
        }
    }
}

/// Handler to delete a category.
/// Requires Admin privileges.
pub async fn delete_category_handler(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(category_id): Path<Uuid>,
) -> Response {
    match category_repository::delete_category(&state.db_pool, category_id).await {
        Ok(rows_affected) if rows_affected == 1 => {
            // Successfully deleted
            (StatusCode::NO_CONTENT).into_response()
        }
        Ok(_) => {
            // No rows affected, meaning category not found
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to delete category: {}", e);
            // Could be constraint violation if ON DELETE is restricted, etc.
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete category").into_response()
        }
    }
} 