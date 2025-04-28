use sqlx::PgPool;
use uuid::Uuid;
use crate::models::Thread;
use crate::utils::PaginationParams;

// Placeholder for Polycentric ID - replace with actual type if needed
type PolycentricId = String;

// Input data for creating a new thread
#[derive(serde::Deserialize)]
pub struct CreateThreadData {
    pub title: String,
    pub created_by: PolycentricId, // Assuming this comes from the client
    // board_id will come from the path
}

// Input data for updating a thread (only title allowed for now)
#[derive(serde::Deserialize)]
pub struct UpdateThreadData {
    pub title: String,
}

/// Inserts a new thread into the database, associated with a board.
pub async fn create_thread(
    pool: &PgPool,
    board_id: Uuid,
    thread_data: CreateThreadData,
) -> Result<Thread, sqlx::Error> {
    let new_thread = sqlx::query_as!(
        Thread,
        r#"
        INSERT INTO threads (board_id, title, created_by)
        VALUES ($1, $2, $3)
        RETURNING id, board_id, title, created_by, created_at
        "#,
        board_id,
        thread_data.title,
        thread_data.created_by
    )
    .fetch_one(pool)
    .await?;
    Ok(new_thread)
}

/// Fetches a single thread by its ID.
pub async fn get_thread_by_id(pool: &PgPool, thread_id: Uuid) -> Result<Option<Thread>, sqlx::Error> {
    let thread = sqlx::query_as!(
        Thread,
        r#"
        SELECT id, board_id, title, created_by, created_at
        FROM threads
        WHERE id = $1
        "#,
        thread_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(thread)
}

/// Fetches all threads belonging to a specific board with pagination.
pub async fn get_threads_by_board(
    pool: &PgPool,
    board_id: Uuid,
    pagination: &PaginationParams,
) -> Result<Vec<Thread>, sqlx::Error> {
    let threads = sqlx::query_as!(
        Thread,
        r#"
        SELECT id, board_id, title, created_by, created_at
        FROM threads
        WHERE board_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
        board_id,
        pagination.limit() as i64,
        pagination.offset() as i64
    )
    .fetch_all(pool)
    .await?;
    Ok(threads)
}

/// Updates an existing thread's title.
pub async fn update_thread(
    pool: &PgPool,
    thread_id: Uuid,
    update_data: UpdateThreadData,
) -> Result<Option<Thread>, sqlx::Error> {
    let updated_thread = sqlx::query_as!(
        Thread,
        r#"
        UPDATE threads
        SET title = $1
        WHERE id = $2
        RETURNING id, board_id, title, created_by, created_at
        "#,
        update_data.title,
        thread_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(updated_thread)
}

/// Deletes a thread by its ID.
/// Returns the number of rows affected.
pub async fn delete_thread(pool: &PgPool, thread_id: Uuid) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        DELETE FROM threads
        WHERE id = $1
        "#,
        thread_id
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
} 