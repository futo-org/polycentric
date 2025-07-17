use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

// Placeholder for Polycentric ID
type PolycentricId = Vec<u8>;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ForumUser {
    pub public_key: PolycentricId,
    pub first_post_at: Option<DateTime<Utc>>,
    pub last_post_at: Option<DateTime<Utc>>,
    pub total_posts: Option<i64>,
    pub total_threads: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BannedUser {
    pub id: Uuid,
    pub public_key: PolycentricId,
    pub banned_by: PolycentricId,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct BanUserData {
    pub public_key: PolycentricId,
    pub reason: Option<String>,
}

/// Get all users who have posted on the forum with their statistics
pub async fn get_all_users(pool: &PgPool) -> Result<Vec<ForumUser>, sqlx::Error> {
    let users = sqlx::query_as!(
        ForumUser,
        r#"
        WITH user_stats AS (
            SELECT 
                author_id as public_key,
                MIN(created_at) as first_post_at,
                MAX(created_at) as last_post_at,
                COUNT(*) as total_posts
            FROM posts 
            GROUP BY author_id
        ),
        thread_stats AS (
            SELECT 
                created_by as public_key,
                COUNT(*) as total_threads
            FROM threads 
            GROUP BY created_by
        )
        SELECT 
            us.public_key,
            us.first_post_at,
            us.last_post_at,
            us.total_posts,
            COALESCE(ts.total_threads, 0) as "total_threads!"
        FROM user_stats us
        LEFT JOIN thread_stats ts ON us.public_key = ts.public_key
        ORDER BY us.last_post_at DESC
        "#
    )
    .fetch_all(pool)
    .await?;

    Ok(users)
}

/// Check if a user is banned
pub async fn is_user_banned(pool: &PgPool, public_key: &[u8]) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        "SELECT 1 as exists FROM banned_users WHERE public_key = $1",
        public_key
    )
    .fetch_optional(pool)
    .await?;

    Ok(result.is_some())
}

/// Ban a user
pub async fn ban_user(
    pool: &PgPool,
    public_key: &[u8],
    banned_by: &[u8],
    reason: Option<&str>,
) -> Result<BannedUser, sqlx::Error> {
    let banned_user = sqlx::query_as!(
        BannedUser,
        r#"
        INSERT INTO banned_users (public_key, banned_by, reason)
        VALUES ($1, $2, $3)
        RETURNING id, public_key, banned_by, reason, created_at
        "#,
        public_key,
        banned_by,
        reason
    )
    .fetch_one(pool)
    .await?;

    Ok(banned_user)
}

/// Unban a user
pub async fn unban_user(pool: &PgPool, public_key: &[u8]) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!("DELETE FROM banned_users WHERE public_key = $1", public_key)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

/// Get all banned users
pub async fn get_banned_users(pool: &PgPool) -> Result<Vec<BannedUser>, sqlx::Error> {
    let banned_users = sqlx::query_as!(
        BannedUser,
        r#"
        SELECT id, public_key, banned_by, reason, created_at
        FROM banned_users
        ORDER BY created_at DESC
        "#
    )
    .fetch_all(pool)
    .await?;

    Ok(banned_users)
}

/// Get a specific banned user
pub async fn get_banned_user(
    pool: &PgPool,
    public_key: &[u8],
) -> Result<Option<BannedUser>, sqlx::Error> {
    let banned_user = sqlx::query_as!(
        BannedUser,
        r#"
        SELECT id, public_key, banned_by, reason, created_at
        FROM banned_users
        WHERE public_key = $1
        "#,
        public_key
    )
    .fetch_optional(pool)
    .await?;

    Ok(banned_user)
}
