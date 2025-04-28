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

/// Represents a post (reply) within a thread.
#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct Post {
    pub id: Uuid,
    pub thread_id: Uuid, // Foreign key to Thread
    pub author_id: PolycentricId,
    pub content: String, // For now, simple text content
    pub created_at: DateTime<Utc>,
    pub quote_of: Option<Uuid>, // ID of the post being quoted, if any
    //pub edited_at: Option<DateTime<Utc>>,
    // Could add fields like images, edit history, etc.
} 