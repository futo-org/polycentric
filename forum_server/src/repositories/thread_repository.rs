use sqlx::PgPool;
use uuid::Uuid;
use crate::models::{Thread, Post};
use crate::utils::PaginationParams;
use crate::repositories::post_repository;
use sqlx::Acquire;

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
    // board_id will come from the path
}

// Input data for updating a thread (only title allowed for now)
#[derive(serde::Deserialize)]
pub struct UpdateThreadData {
    pub title: String,
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
pub async fn create_thread_with_initial_post(
    pool: &PgPool,
    board_id: Uuid,
    data: CreateThreadData, // Contains title, content, created_by, optional images
) -> Result<Thread, sqlx::Error> {
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

    // 2. Create the initial post (without quote_of or direct images column)
    let new_post_id = sqlx::query!(
        r#"
        INSERT INTO posts (thread_id, author_id, content) 
        VALUES ($1, $2::BYTEA, $3)
        RETURNING id
        "#,
        new_thread.id, 
        &data.created_by, // Use the same author as the thread creator
        data.content      // Use the provided content
    )
    .fetch_one(&mut *tx)
    .await? // Fetch the result row containing the ID
    .id;     // Extract the ID from the fetched row
    
    // 3. Insert images for the post if provided
    if let Some(image_urls) = data.images {
        if !image_urls.is_empty() {
            // Prepare batch insert for images
            let mut query_builder = sqlx::QueryBuilder::new(
                "INSERT INTO post_images (post_id, image_url) "
            );
            query_builder.push_values(image_urls.iter(), |mut b, image_url| {
                b.push_bind(new_post_id) // Use the ID of the post created in step 2
                 .push_bind(image_url);
            });
            // No RETURNING needed if we don't use the PostImage IDs immediately
            let query = query_builder.build(); 
            query.execute(&mut *tx).await?; // Execute batch insert
        }
    }

    // Commit transaction
    tx.commit().await?;

    // Return the created thread info (post info isn't needed by the handler's return type)
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