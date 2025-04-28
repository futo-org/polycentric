use sqlx::PgPool;
use uuid::Uuid;
use crate::models::Board;

// Input data for creating a new board
#[derive(serde::Deserialize)]
pub struct CreateBoardData {
    pub name: String,
    pub description: String,
    // category_id will come from the path param usually
}

/// Inserts a new board into the database, associated with a category.
pub async fn create_board(
    pool: &PgPool,
    category_id: Uuid,
    board_data: CreateBoardData,
) -> Result<Board, sqlx::Error> {
    let new_board = sqlx::query_as!(
        Board,
        r#"
        INSERT INTO boards (category_id, name, description)
        VALUES ($1, $2, $3)
        RETURNING id, category_id, name, description, created_at
        "#,
        category_id,
        board_data.name,
        board_data.description
    )
    .fetch_one(pool)
    .await?;
    Ok(new_board)
}

/// Fetches a single board by its ID.
pub async fn get_board_by_id(pool: &PgPool, board_id: Uuid) -> Result<Option<Board>, sqlx::Error> {
    let board = sqlx::query_as!(
        Board,
        r#"
        SELECT id, category_id, name, description, created_at
        FROM boards
        WHERE id = $1
        "#,
        board_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(board)
}

/// Fetches all boards belonging to a specific category.
pub async fn get_boards_by_category(
    pool: &PgPool,
    category_id: Uuid,
) -> Result<Vec<Board>, sqlx::Error> {
    let boards = sqlx::query_as!(
        Board,
        r#"
        SELECT id, category_id, name, description, created_at
        FROM boards
        WHERE category_id = $1
        ORDER BY created_at DESC
        "#,
        category_id
    )
    .fetch_all(pool)
    .await?;
    Ok(boards)
}

// Input data for updating a board
#[derive(serde::Deserialize)]
pub struct UpdateBoardData {
    pub name: String,
    pub description: String,
}

/// Updates an existing board.
pub async fn update_board(
    pool: &PgPool,
    board_id: Uuid,
    update_data: UpdateBoardData,
) -> Result<Option<Board>, sqlx::Error> {
    let updated_board = sqlx::query_as!(
        Board,
        r#"
        UPDATE boards
        SET name = $1, description = $2
        WHERE id = $3
        RETURNING id, category_id, name, description, created_at
        "#,
        update_data.name,
        update_data.description,
        board_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(updated_board)
}

/// Deletes a board by its ID.
/// Returns the number of rows affected.
pub async fn delete_board(pool: &PgPool, board_id: Uuid) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        DELETE FROM boards
        WHERE id = $1
        "#,
        board_id
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
} 