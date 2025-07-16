use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use tracing::{error, info, warn};
use uuid::Uuid;
use crate::{
    models::{Board, Category},
    repositories::{board_repository::{self, CreateBoardData, UpdateBoardData}, category_repository},
    utils::PaginationParams,
    AppState,
    auth::AdminUser,
};
use serde::Deserialize;

pub async fn create_board_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(category_id): Path<Uuid>,
    Json(payload): Json<CreateBoardData>,
) -> Response {
    match category_repository::get_category_by_id(&state.db_pool, category_id).await {
        Ok(Some(_)) => {
            match board_repository::create_board(&state.db_pool, category_id, payload).await {
                Ok(new_board) => {
                    info!(category_id = %category_id, board_id = %new_board.id, "Successfully created board");
                    (StatusCode::CREATED, Json(new_board)).into_response()
                }
                Err(e) => {
                    error!(error = %e, category_id = %category_id, "Failed to create board");
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create board").into_response()
                }
            }
        }
        Ok(None) => {
            error!(category_id = %category_id, "Attempted to create board in non-existent category");
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            error!(error = %e, category_id = %category_id, "Failed to check category existence before creating board");
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking category").into_response()
        }
    }
}

pub async fn get_board_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
) -> Response {
    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(board)) => {
            (StatusCode::OK, Json(board)).into_response()
        }
        Ok(None) => {
            (StatusCode::NOT_FOUND, "Board not found").into_response()
        }
        Err(e) => {
            error!(error = %e, board_id = %board_id, "Failed to fetch board");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch board").into_response()
        }
    }
}

pub async fn list_boards_in_category_handler(
    State(state): State<AppState>,
    Path(category_id): Path<Uuid>,
    Query(pagination): Query<PaginationParams>,
) -> Response {
    match category_repository::get_category_by_id(&state.db_pool, category_id).await {
        Ok(Some(_)) => {
            match board_repository::get_boards_by_category(&state.db_pool, category_id, &pagination).await {
                Ok(boards) => {
                    (StatusCode::OK, Json(boards)).into_response()
                }
                Err(e) => {
                    error!(error = %e, category_id = %category_id, "Failed to fetch boards for category");
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch boards").into_response()
                }
            }
        }
        Ok(None) => {
            warn!(category_id = %category_id, "Attempted to list boards for non-existent category");
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            error!(error = %e, category_id = %category_id, "Failed to check category existence before listing boards");
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking category").into_response()
        }
    }
}

pub async fn update_board_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(board_id): Path<Uuid>,
    Json(payload): Json<UpdateBoardData>,
) -> Response {
    match board_repository::update_board(&state.db_pool, board_id, payload).await {
        Ok(Some(updated_board)) => {
            info!(board_id = %updated_board.id, "Successfully updated board");
            (StatusCode::OK, Json(updated_board)).into_response()
        }
        Ok(None) => {
            warn!(board_id = %board_id, "Attempted to update non-existent board");
            (StatusCode::NOT_FOUND, "Board not found").into_response()
        }
        Err(e) => {
            error!(error = %e, board_id = %board_id, "Failed to update board");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update board").into_response()
        }
    }
}

pub async fn delete_board_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(board_id): Path<Uuid>,
) -> Response {
    match board_repository::delete_board(&state.db_pool, board_id).await {
        Ok(rows_affected) if rows_affected == 1 => {
            info!(board_id = %board_id, "Successfully deleted board");
            (StatusCode::NO_CONTENT).into_response()
        }
        Ok(_) => {
            warn!(board_id = %board_id, "Attempted to delete non-existent board");
            (StatusCode::NOT_FOUND, "Board not found").into_response()
        }
        Err(e) => {
            error!(error = %e, board_id = %board_id, "Failed to delete board");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete board").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct ReorderBoardsPayload {
    ordered_ids: Vec<Uuid>,
}

pub async fn reorder_boards_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(payload): Json<ReorderBoardsPayload>,
) -> impl IntoResponse {
    match board_repository::update_board_order(&state.db_pool, &payload.ordered_ids).await {
        Ok(_) => {
            info!(count = payload.ordered_ids.len(), "Successfully reordered boards");
            StatusCode::OK
        }
        Err(e) => {
            error!(error = %e, count = payload.ordered_ids.len(), "Failed to reorder boards");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
} 