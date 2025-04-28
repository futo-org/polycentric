use sqlx::PgPool;
use uuid::Uuid;
use crate::models::Post;
use crate::utils::PaginationParams;

// Placeholder for Polycentric ID
type PolycentricId = String;

// Input data for creating a new post
#[derive(serde::Deserialize)]
pub struct CreatePostData {
    pub author_id: PolycentricId, // Assuming this comes from client authentication/context
    pub content: String,
    pub quote_of: Option<Uuid>, // Optional ID of the post being quoted
    // thread_id will come from the path
}

// Input data for updating a post (only content for now)
#[derive(serde::Deserialize)]
pub struct UpdatePostData {
    pub content: String,
    // Could add author_id here if needed for validation
}

/// Inserts a new post into the database, associated with a thread.
pub async fn create_post(
    pool: &PgPool,
    thread_id: Uuid,
    post_data: CreatePostData,
) -> Result<Post, sqlx::Error> {
    let new_post = sqlx::query_as!(
        Post,
        r#"
        INSERT INTO posts (thread_id, author_id, content, quote_of)
        VALUES ($1, $2, $3, $4)
        RETURNING id, thread_id, author_id, content, created_at, quote_of
        "#,
        thread_id,
        post_data.author_id,
        post_data.content,
        post_data.quote_of
    )
    .fetch_one(pool)
    .await?;
    Ok(new_post)
}

/// Fetches a single post by its ID.
pub async fn get_post_by_id(pool: &PgPool, post_id: Uuid) -> Result<Option<Post>, sqlx::Error> {
    let post = sqlx::query_as!(
        Post,
        r#"
        SELECT id, thread_id, author_id, content, created_at, quote_of
        FROM posts
        WHERE id = $1
        "#,
        post_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(post)
}

/// Fetches all posts belonging to a specific thread with pagination.
/// Typically ordered by creation time ASC.
pub async fn get_posts_by_thread(
    pool: &PgPool,
    thread_id: Uuid,
    pagination: &PaginationParams,
) -> Result<Vec<Post>, sqlx::Error> {
    let posts = sqlx::query_as!(
        Post,
        r#"
        SELECT id, thread_id, author_id, content, created_at, quote_of
        FROM posts
        WHERE thread_id = $1
        ORDER BY created_at ASC
        LIMIT $2 OFFSET $3
        "#,
        thread_id,
        pagination.limit() as i64,
        pagination.offset() as i64
    )
    .fetch_all(pool)
    .await?;
    Ok(posts)
}

/// Updates an existing post's content.
/// Optionally, could add an author_id check here or in the handler.
pub async fn update_post(
    pool: &PgPool,
    post_id: Uuid,
    // author_id: &PolycentricId, // Needed for ownership check
    update_data: UpdatePostData,
) -> Result<Option<Post>, sqlx::Error> {
    let updated_post = sqlx::query_as!(
        Post,
        r#"
        UPDATE posts
        SET content = $1
        WHERE id = $2
        -- AND author_id = $3 -- Add this line for ownership check
        RETURNING id, thread_id, author_id, content, created_at, quote_of
        "#,
        update_data.content,
        post_id,
        // author_id // Add this parameter for ownership check
    )
    .fetch_optional(pool)
    .await?;

    Ok(updated_post)
}

/// Deletes a post by its ID.
/// Optionally, could add an author_id check.
/// Returns the number of rows affected.
pub async fn delete_post(
    pool: &PgPool,
    post_id: Uuid,
    // author_id: &PolycentricId // Needed for ownership check
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        DELETE FROM posts
        WHERE id = $1
        -- AND author_id = $2 -- Add for ownership check
        "#,
        post_id,
        // author_id // Add for ownership check
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
} 