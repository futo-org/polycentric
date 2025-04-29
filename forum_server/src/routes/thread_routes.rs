use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    models::Thread,
    repositories::thread_repository,
    errors::AppError,
    AppState,
    auth::AuthenticatedUser,
};

// ... ListThreadsParams definition ...

// ... list_threads_in_board_handler ...

// ... get_thread_handler ...

#[derive(Deserialize)]
pub struct CreateThreadPayload {
    title: String,
}

pub async fn create_thread_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<CreateThreadPayload>,
) -> Result<(StatusCode, Json<Thread>), AppError> {
    let created_by = user.0;
    let thread = thread_repository::create_thread(&state.db_pool, board_id, &payload.title, &created_by).await?;
    Ok((StatusCode::CREATED, Json(thread)))
}

#[derive(Deserialize)]
pub struct UpdateThreadPayload {
    title: String,
}

pub async fn update_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<UpdateThreadPayload>,
) -> Result<Json<Thread>, AppError> {
    // Fetch thread to check ownership
    let thread_to_update = thread_repository::get_thread_by_id(&state.db_pool, thread_id).await?;

    // Authorization check
    if thread_to_update.created_by != user.0 {
        return Err(AppError::forbidden());
    }

    // Proceed with update if authorized
    let thread = thread_repository::update_thread(&state.db_pool, thread_id, &payload.title).await?;
    Ok(Json(thread))
}

pub async fn delete_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
) -> Result<StatusCode, AppError> {
    // Fetch thread to check ownership
    let thread_to_delete = thread_repository::get_thread_by_id(&state.db_pool, thread_id).await?;

    // Authorization check
    if thread_to_delete.created_by != user.0 {
         return Err(AppError::forbidden());
    }
    
    // Proceed with delete if authorized
    thread_repository::delete_thread(&state.db_pool, thread_id).await?;
    Ok(StatusCode::NO_CONTENT)
} 