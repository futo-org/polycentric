use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;
use crate::{
    models::{Board, Category}, // Include Category for checking existence
    repositories::{board_repository::{self, CreateBoardData, UpdateBoardData}, category_repository}, // Import both repos
    utils::PaginationParams, // Import
    AppState,
};

/// Handler to create a new board within a category.
pub async fn create_board_handler(
    State(state): State<AppState>,
    Path(category_id): Path<Uuid>, // Extract category_id from path
    Json(payload): Json<CreateBoardData>,
) -> Response {
    // Optional: Check if category exists first (good practice)
    match category_repository::get_category_by_id(&state.db_pool, category_id).await {
        Ok(Some(_)) => {
            // Category exists, proceed to create board
            match board_repository::create_board(&state.db_pool, category_id, payload).await {
                Ok(new_board) => {
                    (StatusCode::CREATED, Json(new_board)).into_response()
                }
                Err(e) => {
                    eprintln!("Failed to create board: {}", e);
                    // Could be a DB constraint error, etc.
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create board").into_response()
                }
            }
        }
        Ok(None) => {
            // Category not found
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to check category existence: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking category").into_response()
        }
    }
}

/// Handler to get a single board by its ID.
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
            eprintln!("Failed to fetch board: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch board").into_response()
        }
    }
}

/// Handler to list all boards within a specific category with pagination.
pub async fn list_boards_in_category_handler(
    State(state): State<AppState>,
    Path(category_id): Path<Uuid>,
    Query(pagination): Query<PaginationParams>, // Extract pagination
) -> Response {
    // Optional: Check if category exists first
    match category_repository::get_category_by_id(&state.db_pool, category_id).await {
        Ok(Some(_)) => {
            // Category exists, proceed to list boards
            match board_repository::get_boards_by_category(&state.db_pool, category_id, &pagination).await {
                Ok(boards) => {
                    (StatusCode::OK, Json(boards)).into_response()
                }
                Err(e) => {
                    eprintln!("Failed to fetch boards for category {}: {}", category_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch boards").into_response()
                }
            }
        }
        Ok(None) => {
            // Category not found
            (StatusCode::NOT_FOUND, "Category not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to check category existence: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking category").into_response()
        }
    }
}

/// Handler to update a board.
pub async fn update_board_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    Json(payload): Json<UpdateBoardData>,
) -> Response {
    match board_repository::update_board(&state.db_pool, board_id, payload).await {
        Ok(Some(updated_board)) => {
            (StatusCode::OK, Json(updated_board)).into_response()
        }
        Ok(None) => {
            (StatusCode::NOT_FOUND, "Board not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to update board: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update board").into_response()
        }
    }
}

/// Handler to delete a board.
pub async fn delete_board_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
) -> Response {
    match board_repository::delete_board(&state.db_pool, board_id).await {
        Ok(rows_affected) if rows_affected == 1 => {
            (StatusCode::NO_CONTENT).into_response()
        }
        Ok(_) => {
            (StatusCode::NOT_FOUND, "Board not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to delete board: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete board").into_response()
        }
    }
} 