use sqlx::PgPool;
use uuid::Uuid;
use crate::models::{Thread, Post};
use crate::utils::PaginationParams;
use crate::repositories::post_repository;
use sqlx::{Acquire, Postgres, Transaction};

// Placeholder for Polycentric ID - replace with actual type if needed
type PolycentricId = Vec<u8>;

// Input data for creating a new thread
#[derive(serde::Deserialize)]
pub struct CreateThreadData {
    pub title: String,
    pub content: String,
    #[serde(skip_deserializing)]
    pub created_by: PolycentricId,
    #[serde(default)] 
    pub images: Option<Vec<String>>,
    // Added optional fields for Polycentric pointer
    #[serde(default)]
    pub polycentric_system_id: Option<PolycentricId>,
    #[serde(default)]
    pub polycentric_process_id: Option<PolycentricId>,
    #[serde(default)]
    pub polycentric_log_seq: Option<i64>, 
    // board_id will come from the path
}

// Input data for updating a thread (only title allowed for now)
#[derive(serde::Deserialize)]
pub struct UpdateThreadData {
    pub title: String,
}

// Define a new struct to return both Thread and initial Post ID
#[derive(Debug, serde::Serialize)] // Add Serialize derive
pub struct CreatedThreadInfo {
    pub thread: Thread,
    pub initial_post_id: Uuid,
}

/// Deprecated: Use create_thread_with_initial_post instead.
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
        VALUES ($1, $2, $3::BYTEA)
        RETURNING id, board_id, title, created_by, created_at
        "#,
        board_id,
        thread_data.title,
        &thread_data.created_by
    )
    .fetch_one(pool)
    .await?;
    Ok(new_thread)
}

/// Creates a new thread and its initial post (with optional images) within a transaction.
/// Returns the created Thread info and the ID of the initial post.
pub async fn create_thread_with_initial_post(
    pool: &PgPool,
    board_id: Uuid,
    data: CreateThreadData, 
) -> Result<CreatedThreadInfo, sqlx::Error> { // Return new struct type
    let mut tx = pool.begin().await?;

    // 1. Create the thread
    let new_thread = sqlx::query_as!(
        Thread,
        r#"
        INSERT INTO threads (board_id, title, created_by)
        VALUES ($1, $2, $3::BYTEA)
        RETURNING id, board_id, title, created_by, created_at
        "#,
        board_id,
        data.title,
        &data.created_by
    )
    .fetch_one(&mut *tx)
    .await?;

    // 2. Create the initial post 
    let new_post_id = sqlx::query!(
        r#"
        INSERT INTO posts (thread_id, author_id, content) 
        VALUES ($1, $2::BYTEA, $3)
        RETURNING id
        "#,
        new_thread.id, 
        &data.created_by, 
        data.content      
    )
    .fetch_one(&mut *tx)
    .await?
    .id;     
    
    // 3. Insert images for the post if provided
    // ... existing image insert logic ...

    // Commit transaction
    tx.commit().await?;

    // Return the combined info
    Ok(CreatedThreadInfo {
        thread: new_thread,
        initial_post_id: new_post_id,
    })
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

// --- Add missing functions ---

pub async fn get_thread_author(pool: &PgPool, thread_id: Uuid) -> Result<Option<Vec<u8>>, sqlx::Error> {
    let result = sqlx::query!(
        r#"SELECT created_by FROM threads WHERE id = $1"#,
        thread_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(result.map(|row| row.created_by))
}

pub async fn delete_thread_with_posts(pool: &PgPool, thread_id: Uuid) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await?;

    // 1. Delete associated post images (handle foreign key constraint)
    sqlx::query!(
        "DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE thread_id = $1)",
        thread_id
    )
    .execute(&mut *tx)
    .await?;

    // 2. Delete posts in the thread
    sqlx::query!(
        "DELETE FROM posts WHERE thread_id = $1",
        thread_id
    )
    .execute(&mut *tx)
    .await?;

    // 3. Delete the thread itself
    let result = sqlx::query!(
        "DELETE FROM threads WHERE id = $1",
        thread_id
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(result.rows_affected())
} 