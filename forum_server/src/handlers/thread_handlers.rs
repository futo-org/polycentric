use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;
use crate::{
    models::Thread,
    repositories::{self, board_repository, thread_repository::{self, CreateThreadData, UpdateThreadData}},
    utils::PaginationParams, // Import
    AppState,
    auth::AuthenticatedUser, // Import the extractor
};
use serde::Deserialize;

/// Handler to create a new thread within a board.
pub async fn create_thread_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<CreateThreadPayload>,
) -> Response {
    let created_by = user.0;

    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(_)) => { /* Board exists, continue */ }
        Ok(None) => return (StatusCode::NOT_FOUND, "Board not found").into_response(),
        Err(e) => {
            eprintln!("DB error checking board existence: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Error checking board existence").into_response();
        }
    }

    let thread_data = repositories::thread_repository::CreateThreadData {
        title: payload.title,
        created_by,
    };

    // Use match for error handling
    match thread_repository::create_thread(&state.db_pool, board_id, thread_data).await {
        Ok(thread) => (StatusCode::CREATED, Json(thread)).into_response(),
        Err(e) => {
            eprintln!("Failed to create thread: {}", e);
            // Add checks for specific DB errors if needed (e.g., unique constraints)
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create thread").into_response()
        }
    }
}

/// Handler to get a single thread by its ID.
pub async fn get_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
) -> Response {
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread)) => (StatusCode::OK, Json(thread)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            eprintln!("Failed to fetch thread: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch thread").into_response()
        }
    }
}

/// Handler to list all threads within a specific board with pagination.
pub async fn list_threads_in_board_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    Query(pagination): Query<PaginationParams>,
) -> Response {
    // Check if board exists first
    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(_)) => {
            // Board exists, list threads
            match thread_repository::get_threads_by_board(&state.db_pool, board_id, &pagination).await {
                Ok(threads) => (StatusCode::OK, Json(threads)).into_response(),
                Err(e) => {
                    eprintln!("Failed to fetch threads for board {}: {}", board_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch threads").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Board not found").into_response(),
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
    user: AuthenticatedUser,
    Json(payload): Json<UpdateThreadPayload>,
) -> Response {
    // Fetch thread first
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread_to_update)) => {
            // Authorization check
            if thread_to_update.created_by != user.0 {
                return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }

            // Construct update data
            let update_data = UpdateThreadData { title: payload.title };

            // Perform update
            match thread_repository::update_thread(&state.db_pool, thread_id, update_data).await {
                Ok(Some(updated_thread)) => (StatusCode::OK, Json(updated_thread)).into_response(),
                Ok(None) => (StatusCode::NOT_FOUND, "Thread not found during update").into_response(), // Should be rare
                Err(e) => {
                    eprintln!("Failed to update thread: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update thread").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            eprintln!("Failed to fetch thread for update: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching thread for update").into_response()
        }
    }
}

/// Handler to delete a thread.
pub async fn delete_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
) -> Response {
    // Fetch thread first
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread_to_delete)) => {
            // Authorization check
            if thread_to_delete.created_by != user.0 {
                 return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }
            
            // Perform delete
            match thread_repository::delete_thread(&state.db_pool, thread_id).await {
                 Ok(0) => (StatusCode::NOT_FOUND, "Thread not found during delete").into_response(), // Should be rare
                 Ok(_) => (StatusCode::NO_CONTENT).into_response(), // Success (1 row deleted)
                 Err(e) => {
                    eprintln!("Failed to delete thread: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete thread").into_response()
                 }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            eprintln!("Failed to fetch thread for delete: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching thread for delete").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct CreateThreadPayload {
    title: String,
}

#[derive(Deserialize)]
pub struct UpdateThreadPayload {
    title: String,
} 