use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

// Using Polycentric ID as a placeholder string for now.
// We might refine this later based on the actual Polycentric ID format.
type PolycentricId = String;

/// Represents a top-level category in the forum.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct Category {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
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
    //pub edited_at: Option<DateTime<Utc>>,
} 