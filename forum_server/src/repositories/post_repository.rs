use sqlx::{PgPool, Transaction, Postgres};
use uuid::Uuid;
use crate::{
    models::{Post, PostImage},
    utils::PaginationParams,
};

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
}

// Input data for updating a post (only content for now)
#[derive(serde::Deserialize)]
pub struct UpdatePostData {
    pub content: String,
    // TODO: Add optional images field for updating images?
}

// Intermediate struct to fetch basic post data before images
#[derive(sqlx::FromRow)] // Added FromRow
struct PostBaseData {
    id: Uuid,
    thread_id: Uuid,
    author_id: PolycentricId, // Now Vec<u8>
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
    quote_of: Option<Uuid>,
}

/// Inserts a new post and its associated images within a transaction.
pub async fn create_post(
    pool: &PgPool,
    thread_id: Uuid,
    post_data: CreatePostData, // Contains Vec<u8>
) -> Result<Post, sqlx::Error> {
    // Start a transaction
    let mut tx = pool.begin().await?;

    // 1. Insert the main post data
    let post_base = sqlx::query_as!(
        PostBaseData,
        r#"
        INSERT INTO posts (thread_id, author_id, content, quote_of)
        VALUES ($1, $2::BYTEA, $3, $4)
        RETURNING id, thread_id, author_id, content, created_at, quote_of
        "#,
        thread_id,
        &post_data.author_id, // Keep binding as slice
        post_data.content,
        post_data.quote_of
    )
    .fetch_one(&mut *tx) // Use transaction
    .await?;

    // 2. Insert images if provided
    let mut inserted_images: Vec<PostImage> = Vec::new();
    if let Some(image_urls) = post_data.images {
        if !image_urls.is_empty() {
            // Prepare batch insert for images
            let mut query_builder = sqlx::QueryBuilder::new(
                "INSERT INTO post_images (post_id, image_url) "
            );
            query_builder.push_values(image_urls.iter(), |mut b, image_url| {
                b.push_bind(post_base.id)
                 .push_bind(image_url);
            });
            query_builder.push(" RETURNING id, post_id, image_url, created_at");

            let query = query_builder.build_query_as::<PostImage>();

            inserted_images = query.fetch_all(&mut *tx).await?; // Use transaction
        }
    }

    // Commit the transaction
    tx.commit().await?;

    // Construct the final Post struct
    let new_post = Post {
        id: post_base.id,
        thread_id: post_base.thread_id,
        author_id: post_base.author_id, // Assign Vec<u8>
        content: post_base.content,
        created_at: post_base.created_at,
        quote_of: post_base.quote_of,
        images: inserted_images,
    };

    Ok(new_post)
}

/// Fetches a single post by its ID, including its images.
pub async fn get_post_by_id(pool: &PgPool, post_id: Uuid) -> Result<Option<Post>, sqlx::Error> {
    // 1. Fetch the base post data
    let post_base_opt = sqlx::query_as!( PostBaseData,
        r#"SELECT id, thread_id, author_id, content, created_at, quote_of FROM posts WHERE id = $1"#,
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
            author_id: post_base.author_id, // Assign Vec<u8>
            content: post_base.content,
            created_at: post_base.created_at,
            quote_of: post_base.quote_of,
            images,
        }))
    } else {
        Ok(None)
    }
}

/// Fetches all posts belonging to a specific thread with pagination, including images.
pub async fn get_posts_by_thread(
    pool: &PgPool,
    thread_id: Uuid,
    pagination: &PaginationParams,
) -> Result<Vec<Post>, sqlx::Error> {
    // 1. Fetch base data for posts in the page
    let post_bases = sqlx::query_as!(
        PostBaseData,
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

    if post_bases.is_empty() {
        return Ok(Vec::new());
    }

    // 2. Collect post IDs for image fetching
    let post_ids: Vec<Uuid> = post_bases.iter().map(|p| p.id).collect();

    // 3. Fetch all images associated with these post IDs
    let images = sqlx::query_as!(PostImage,
        r#"
        SELECT id, post_id, image_url, created_at
        FROM post_images
        WHERE post_id = ANY($1)
        ORDER BY post_id, created_at ASC -- Ensure consistent order for grouping
        "#,
        &post_ids // Pass the collected IDs
    )
    .fetch_all(pool)
    .await?;

    // 4. Group images by post_id
    use std::collections::HashMap;
    let mut images_map: HashMap<Uuid, Vec<PostImage>> = HashMap::new();
    for image in images {
        images_map.entry(image.post_id).or_default().push(image);
    }

    // 5. Combine base data with images
    let posts: Vec<Post> = post_bases
        .into_iter()
        .map(|base| Post {
            id: base.id,
            thread_id: base.thread_id,
            author_id: base.author_id, // Assign Vec<u8>
            content: base.content,
            created_at: base.created_at,
            quote_of: base.quote_of,
            images: images_map.remove(&base.id).unwrap_or_default(), // Get images for this post
        })
        .collect();

    Ok(posts)
}

/// Updates an existing post's content.
/// NOTE: This version does NOT handle updating images.
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
        // Fetch the updated post data including images
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