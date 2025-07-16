use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use tracing::{error, info, warn};
use uuid::Uuid;
use crate::{
    models::Category,
    repositories::category_repository::{self, CreateCategoryData, UpdateCategoryData},
    utils::PaginationParams,
    AppState,
    auth::AdminUser,
};
use serde::Deserialize;

pub async fn create_category_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(payload): Json<CreateCategoryData>,
) -> Response {
    match category_repository::create_category(&state.db_pool, payload).await {
        Ok(new_category) => {
            info!(category_id = %new_category.id, "Successfully created category");
            (StatusCode::CREATED, Json(new_category)).into_response()
        }
        Err(e) => {
            error!(error = %e, "Failed to create category");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create category").into_response()
        }
    }
}

pub async fn get_category_handler(
    State(state): State<AppState>,
    Path(category_id): Path<Uuid>,
) -> Response {
    match category_repository::get_category_by_id(&state.db_pool, category_id).await {
        Ok(Some(category)) => {
            (StatusCode::OK, Json(category)).into_response()
        }
        Ok(None) => {
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            error!(error = %e, category_id = %category_id, "Failed to fetch category");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch category").into_response()
        }
    }
}

pub async fn list_categories_handler(
    State(state): State<AppState>,
    Query(pagination): Query<PaginationParams>,
) -> Response {
    match category_repository::get_all_categories(&state.db_pool, &pagination).await {
        Ok(categories) => {
            (StatusCode::OK, Json(categories)).into_response()
        }
        Err(e) => {
            error!(error = %e, "Failed to fetch categories");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch categories").into_response()
        }
    }
}

pub async fn update_category_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(category_id): Path<Uuid>,
    Json(payload): Json<UpdateCategoryData>,
) -> Response {
    match category_repository::update_category(&state.db_pool, category_id, payload).await {
        Ok(Some(updated_category)) => {
            info!(category_id = %updated_category.id, "Successfully updated category");
            (StatusCode::OK, Json(updated_category)).into_response()
        }
        Ok(None) => {
            warn!(category_id = %category_id, "Attempted to update non-existent category");
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            error!(error = %e, category_id = %category_id, "Failed to update category");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update category").into_response()
        }
    }
}

pub async fn delete_category_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(category_id): Path<Uuid>,
) -> Response {
    match category_repository::delete_category(&state.db_pool, category_id).await {
        Ok(rows_affected) if rows_affected == 1 => {
            info!(category_id = %category_id, "Successfully deleted category");
            (StatusCode::NO_CONTENT).into_response()
        }
        Ok(_) => {
            warn!(category_id = %category_id, "Attempted to delete non-existent category");
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            error!(error = %e, category_id = %category_id, "Failed to delete category");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete category").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct ReorderPayload {
    ordered_ids: Vec<Uuid>,
}

pub async fn reorder_categories_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(payload): Json<ReorderPayload>,
) -> impl IntoResponse {
    match category_repository::update_category_order(&state.db_pool, &payload.ordered_ids).await {
        Ok(_) => {
            info!(count = payload.ordered_ids.len(), "Successfully reordered categories");
            StatusCode::OK
        }
        Err(e) => {
            error!(error = %e, count = payload.ordered_ids.len(), "Failed to reorder categories");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
} 