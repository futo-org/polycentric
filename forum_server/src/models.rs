use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use sqlx::FromRow;

type PolycentricId = Vec<u8>;

/// Represents a top-level category in the forum.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct Category {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub order: i32,
}

/// Represents a board within a category.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct Board {
    pub id: Uuid,
    pub category_id: Uuid, // Foreign key to Category
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub order: i32,
}

/// Represents a thread within a board.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct Thread {
    pub id: Uuid,
    pub board_id: Uuid, // Foreign key to Board
    pub title: String,
    pub created_by: PolycentricId,
    pub created_at: DateTime<Utc>,
}

/// Represents an image associated with a post.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct PostImage {
    pub id: Uuid,
    pub post_id: Uuid,
    pub image_url: String,
    pub created_at: DateTime<Utc>,
}

/// Represents a post (reply) within a thread.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Post {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub author_id: PolycentricId,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub quote_of: Option<Uuid>,
    #[serde(default)]
    pub images: Vec<PostImage>,
    pub polycentric_system_id: Option<Vec<u8>>,
    pub polycentric_process_id: Option<Vec<u8>>,
    pub polycentric_log_seq: Option<i64>,
}

/// Represents server information.
#[derive(Serialize)]
pub struct ServerInfo {
    pub name: String,
    pub description: String,
    pub logo_url: Option<String>,
} 