use sqlx::{PgPool, Transaction, Postgres};
use uuid::Uuid;
use crate::{
    models::{Post, PostImage},
    utils::PaginationParams,
};
use std::collections::HashMap;
use tracing::debug;

// Placeholder for Polycentric ID
type PolycentricId = Vec<u8>;

// Input data for creating a new post
#[derive(serde::Deserialize)]
pub struct CreatePostData {
    #[serde(skip_deserializing)] // Don't read from request body
    pub author_id: PolycentricId, // Now Vec<u8>
    pub content: String,
    pub quote_of: Option<Uuid>,
    #[serde(default)] // Ensure it defaults to None if missing in JSON
    pub images: Option<Vec<String>>,
    // Added optional fields for Polycentric pointer
    pub polycentric_system_id: Option<PolycentricId>,
    pub polycentric_process_id: Option<PolycentricId>,
    pub polycentric_log_seq: Option<i64>,
}

// Input data for updating a post (only content for now)
#[derive(serde::Deserialize)]
pub struct UpdatePostData {
    pub content: String,
    // TODO: Add optional images field for updating images?
}

// Intermediate struct to fetch base post data including new fields
#[derive(sqlx::FromRow, Debug)] // Added Debug derive
struct PostBaseData {
    id: Uuid,
    thread_id: Uuid,
    author_id: PolycentricId, 
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
    quote_of: Option<Uuid>,
    // --- Added new fields ---
    polycentric_system_id: Option<Vec<u8>>,
    polycentric_process_id: Option<Vec<u8>>,
    polycentric_log_seq: Option<i64>,
}

/// Creates a new post within a thread, potentially including images and a Polycentric pointer.
/// Must be executed within a transaction.
pub async fn create_post<'c>(
    executor: &mut Transaction<'c, Postgres>, // Requires Transaction
    thread_id: Uuid,
    post_data: CreatePostData, 
) -> Result<Post, sqlx::Error> 
{

    // 1. Insert the basic post data, returning only the ID initially.
    let new_post_id = sqlx::query!(
        r#"
        INSERT INTO posts (thread_id, author_id, content, quote_of, 
                           polycentric_system_id, polycentric_process_id, polycentric_log_seq)
        VALUES ($1, $2::BYTEA, $3, $4, $5::BYTEA, $6::BYTEA, $7)
        RETURNING id
        "#,
        thread_id,
        &post_data.author_id, 
        post_data.content,
        post_data.quote_of,
        post_data.polycentric_system_id.as_ref().map(|v| v.as_slice()),
        post_data.polycentric_process_id.as_ref().map(|v| v.as_slice()),
        post_data.polycentric_log_seq,
    )
    .fetch_one(&mut **executor) // Dereference twice to get &mut PgConnection
    .await?
    .id;

    // 2. Insert images if provided, using the same transaction.
    let mut inserted_images: Vec<PostImage> = Vec::new();
    if let Some(image_urls) = &post_data.images {
        if !image_urls.is_empty() {
            let mut query_builder: sqlx::QueryBuilder<sqlx::Postgres> = 
                sqlx::QueryBuilder::new("INSERT INTO post_images (post_id, image_url) ");

            query_builder.push_values(image_urls.iter(), |mut b, image_url| {
                b.push_bind(new_post_id).push_bind(image_url);
            });
            query_builder.push(" RETURNING id, post_id, image_url, created_at");

            let query = query_builder.build_query_as::<PostImage>();
            
            // Use the dereferenced transaction reference again
            inserted_images = query.fetch_all(&mut **executor).await?;
        }
    }

    // 3. Now fetch the full post data using the ID, within the same transaction.
    let final_post_data = sqlx::query_as!( PostBaseData,
        r#"SELECT 
               id, thread_id, author_id, content, created_at, quote_of, 
               polycentric_system_id, polycentric_process_id, polycentric_log_seq 
           FROM posts WHERE id = $1"#,
        new_post_id
    )
    .fetch_one(&mut **executor) // Dereference twice again
    .await?;

    // 4. Construct the final Post object
    Ok(Post {
        id: final_post_data.id,
        thread_id: final_post_data.thread_id,
        author_id: final_post_data.author_id, 
        content: final_post_data.content,
        created_at: final_post_data.created_at,
        quote_of: final_post_data.quote_of,
        images: inserted_images, 
        polycentric_system_id: final_post_data.polycentric_system_id,
        polycentric_process_id: final_post_data.polycentric_process_id,
        polycentric_log_seq: final_post_data.polycentric_log_seq,
    })
}

/// Fetches a single post by its ID, including its images and Polycentric pointers.
pub async fn get_post_by_id(pool: &PgPool, post_id: Uuid) -> Result<Option<Post>, sqlx::Error> {
    // 1. Fetch the base post data including new columns
    let post_base_opt = sqlx::query_as!( PostBaseData,
        r#"SELECT id, thread_id, author_id, content, created_at, quote_of,
                  polycentric_system_id, polycentric_process_id, polycentric_log_seq 
           FROM posts WHERE id = $1"#,
        post_id
    )
    .fetch_optional(pool)
    .await?;

    if let Some(post_base) = post_base_opt {
        // 2. Fetch associated images
        let images = sqlx::query_as!(PostImage,
            "SELECT id, post_id, image_url, created_at FROM post_images WHERE post_id = $1 ORDER BY created_at ASC",
            post_id
        )
        .fetch_all(pool)
        .await?;

        // 3. Combine into Post struct
        Ok(Some(Post {
            id: post_base.id,
            thread_id: post_base.thread_id,
            author_id: post_base.author_id, 
            content: post_base.content,
            created_at: post_base.created_at,
            quote_of: post_base.quote_of,
            images,
            // Assign the new fields
            polycentric_system_id: post_base.polycentric_system_id,
            polycentric_process_id: post_base.polycentric_process_id,
            polycentric_log_seq: post_base.polycentric_log_seq,
        }))
    } else {
        Ok(None)
    }
}

/// Fetches all posts belonging to a specific thread with pagination, including images and Polycentric pointers.
pub async fn get_posts_by_thread(
    pool: &PgPool,
    thread_id: Uuid,
    pagination: &PaginationParams,
) -> Result<Vec<Post>, sqlx::Error> {
    // 1. Fetch base data for posts in the page including new columns
    debug!(?thread_id, ?pagination, "Fetching base post data for thread page");
    let post_bases = sqlx::query_as!(
        PostBaseData,
        r#"
        SELECT id, thread_id, author_id, content, created_at, quote_of,
               polycentric_system_id, polycentric_process_id, polycentric_log_seq
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

    if post_bases.is_empty() {
        debug!(?thread_id, "No base posts found for this page.");
        return Ok(Vec::new());
    }
    debug!(?thread_id, count = post_bases.len(), fetched_post_ids = ?post_bases.iter().map(|p| p.id).collect::<Vec<_>>(), "Fetched base posts");

    // 2. Collect post IDs for image fetching
    let post_ids: Vec<Uuid> = post_bases.iter().map(|p| p.id).collect();
    debug!(?thread_id, ?post_ids, "Collected post IDs for image fetching");

    // 3. Fetch all images associated with these post IDs
    debug!(?thread_id, ?post_ids, "Fetching images for post IDs");
    let images = sqlx::query_as!(PostImage,
        r#"
        SELECT id, post_id, image_url, created_at
        FROM post_images
        WHERE post_id = ANY($1)
        ORDER BY post_id, created_at ASC 
        "#,
        &post_ids 
    )
    .fetch_all(pool)
    .await?;
    debug!(?thread_id, image_count = images.len(), ?images, "Fetched images");

    // 4. Group images by post_id
    let mut images_map: HashMap<Uuid, Vec<PostImage>> = HashMap::new();
    for image in images {
        images_map.entry(image.post_id).or_default().push(image);
    }
    debug!(?thread_id, ?images_map, "Grouped images by post_id");

    // 5. Combine base data with images
    let posts: Vec<Post> = post_bases
        .into_iter()
        .map(|base| Post {
            id: base.id,
            thread_id: base.thread_id,
            author_id: base.author_id, 
            content: base.content,
            created_at: base.created_at,
            quote_of: base.quote_of,
            images: images_map.remove(&base.id).unwrap_or_default(), 
            // Assign new fields
            polycentric_system_id: base.polycentric_system_id,
            polycentric_process_id: base.polycentric_process_id,
            polycentric_log_seq: base.polycentric_log_seq,
        })
        .collect();
    debug!(?thread_id, post_count = posts.len(), ?posts, "Final combined posts before returning");

    Ok(posts)
}

/// Updates an existing post's content.
/// NOTE: This version does NOT handle updating images or the Polycentric pointer.
pub async fn update_post(
    pool: &PgPool,
    post_id: Uuid,
    update_data: UpdatePostData,
) -> Result<Option<Post>, sqlx::Error> {
    // Update only the content
    let updated_rows = sqlx::query!(
        "UPDATE posts SET content = $1 WHERE id = $2",
        update_data.content,
        post_id
    )
    .execute(pool)
    .await?;

    if updated_rows.rows_affected() == 1 {
        // Fetch the updated post data including images/pointer
        get_post_by_id(pool, post_id).await
    } else {
        Ok(None) // Post not found
    }
}

/// Deletes a post by its ID.
/// NOTE: Cascade delete handles images.
pub async fn delete_post(pool: &PgPool, post_id: Uuid) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        "DELETE FROM posts WHERE id = $1",
        post_id
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

// --- Add missing function ---
pub async fn get_post_author(pool: &PgPool, post_id: Uuid) -> Result<Option<Vec<u8>>, sqlx::Error> {
    let result = sqlx::query!(
        r#"SELECT author_id FROM posts WHERE id = $1"#,
        post_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(result.map(|row| row.author_id)) // Extracts the author_id if found
}

/// Updates the Polycentric pointer fields for a specific post.
pub async fn update_polycentric_pointers(
    pool: &PgPool,
    post_id: Uuid,
    system_id: Vec<u8>,
    process_id: Vec<u8>,
    log_seq: i64,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        UPDATE posts
        SET polycentric_system_id = $1,
            polycentric_process_id = $2,
            polycentric_log_seq = $3
        WHERE id = $4
        "#,
        system_id, 
        process_id, 
        log_seq,   
        post_id
    )
    .execute(pool)
    .await?;

    let rows_affected = result.rows_affected();

    Ok(rows_affected)
}

/// Gets the thread ID for a specific post.
pub async fn get_post_thread_id(pool: &PgPool, post_id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    let result = sqlx::query!(
        r#"SELECT thread_id FROM posts WHERE id = $1"#,
        post_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(result.map(|row| row.thread_id))
}

/// Counts the number of posts remaining in a thread.
pub async fn count_posts_in_thread(pool: &PgPool, thread_id: Uuid) -> Result<i64, sqlx::Error> {
    let result = sqlx::query!(
        r#"SELECT COUNT(*) as count FROM posts WHERE thread_id = $1"#,
        thread_id
    )
    .fetch_one(pool)
    .await?;
    Ok(result.count.unwrap_or(0))
} 