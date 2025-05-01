use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use sqlx::FromRow;
// use polycentric_protocol::model::public_key::PublicKey;

// Using Polycentric ID as a placeholder string for now.
// We might refine this later based on the actual Polycentric ID format.
//type PolycentricId = String;
// Use the actual PublicKey type from the protocol crate.
// Note: We'll need to ensure this PublicKey can be serialized/deserialized
// and stored in the database (likely via its byte representation).
// type PolycentricId = PublicKey;
type PolycentricId = Vec<u8>;

/// Represents a top-level category in the forum.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct Category {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    #[sqlx(rename = "category_order")]
    pub order: i32,
    // Could add fields like order, creation timestamp, etc.
}

/// Represents a board within a category.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct Board {
    pub id: Uuid,
    pub category_id: Uuid, // Foreign key to Category
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    #[sqlx(rename = "board_order")]
    pub order: i32,
    // Could add fields like creation timestamp, last post info, etc.
}

/// Represents a thread within a board.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct Thread {
    pub id: Uuid,
    pub board_id: Uuid, // Foreign key to Board
    pub title: String,
    pub created_by: PolycentricId,
    pub created_at: DateTime<Utc>,
    //pub updated_at: DateTime<Utc>, // Tracks last reply time
    // Could add fields like last reply time, number of posts, sticky status, etc.
}

/// Represents an image associated with a post.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct PostImage {
    pub id: Uuid,
    pub post_id: Uuid,
    pub image_url: String,
    // pub alt_text: Option<String>,
    // pub display_order: i32,
    pub created_at: DateTime<Utc>,
}

/// Represents a post (reply) within a thread.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Post {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub author_id: PolycentricId,
    pub content: String, // Contains Markdown
    pub created_at: DateTime<Utc>,
    pub quote_of: Option<Uuid>,
    #[serde(default)] // Default to empty vec if missing
    pub images: Vec<PostImage>, // Add images field
    pub polycentric_system_id: Option<Vec<u8>>,
    pub polycentric_process_id: Option<Vec<u8>>,
    pub polycentric_log_seq: Option<i64>, // Use i64 for BIGINT mapping
}

/// Represents server information.
#[derive(Serialize)]
pub struct ServerInfo {
    pub name: String,
    pub description: String,
    pub logo_url: Option<String>,
    // Add other relevant server info fields here
} 