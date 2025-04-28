use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;
use crate::{
    models::Thread,
    repositories::{thread_repository::{self, CreateThreadData, UpdateThreadData}, board_repository}, // Import thread and board repos
    AppState,
};

/// Handler to create a new thread within a board.
pub async fn create_thread_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>, // Extract board_id from path
    Json(payload): Json<CreateThreadData>,
) -> Response {
    // Optional: Check if board exists first
    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(_)) => {
            // Board exists, proceed to create thread
            match thread_repository::create_thread(&state.db_pool, board_id, payload).await {
                Ok(new_thread) => {
                    (StatusCode::CREATED, Json(new_thread)).into_response()
                }
                Err(e) => {
                    eprintln!("Failed to create thread: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create thread").into_response()
                }
            }
        }
        Ok(None) => {
            // Board not found
            (StatusCode::NOT_FOUND, "Board not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to check board existence: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking board").into_response()
        }
    }
}

/// Handler to get a single thread by its ID.
pub async fn get_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
) -> Response {
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread)) => {
            (StatusCode::OK, Json(thread)).into_response()
        }
        Ok(None) => {
            (StatusCode::NOT_FOUND, "Thread not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to fetch thread: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch thread").into_response()
        }
    }
}

/// Handler to list all threads within a specific board.
pub async fn list_threads_in_board_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
) -> Response {
    // Optional: Check if board exists first
    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(_)) => {
            // Board exists, proceed to list threads
            match thread_repository::get_threads_by_board(&state.db_pool, board_id).await {
                Ok(threads) => {
                    (StatusCode::OK, Json(threads)).into_response()
                }
                Err(e) => {
                    eprintln!("Failed to fetch threads for board {}: {}", board_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch threads").into_response()
                }
            }
        }
        Ok(None) => {
            // Board not found
            (StatusCode::NOT_FOUND, "Board not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to check board existence: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking board").into_response()
        }
    }
}

/// Handler to update a thread's title.
pub async fn update_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    Json(payload): Json<UpdateThreadData>,
) -> Response {
    match thread_repository::update_thread(&state.db_pool, thread_id, payload).await {
        Ok(Some(updated_thread)) => {
            (StatusCode::OK, Json(updated_thread)).into_response()
        }
        Ok(None) => {
            (StatusCode::NOT_FOUND, "Thread not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to update thread: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update thread").into_response()
        }
    }
}

/// Handler to delete a thread.
pub async fn delete_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
) -> Response {
    match thread_repository::delete_thread(&state.db_pool, thread_id).await {
        Ok(rows_affected) if rows_affected == 1 => {
            (StatusCode::NO_CONTENT).into_response()
        }
        Ok(_) => {
            (StatusCode::NOT_FOUND, "Thread not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to delete thread: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete thread").into_response()
        }
    }
} 