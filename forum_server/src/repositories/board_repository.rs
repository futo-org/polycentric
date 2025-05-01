use sqlx::PgPool;
use uuid::Uuid;
use crate::models::Board;
use crate::utils::PaginationParams;
use sqlx::Acquire;

// Input data for creating a new board
#[derive(serde::Deserialize)]
pub struct CreateBoardData {
    pub name: String,
    pub description: String,
    // category_id will come from the path param usually
    // order is managed separately
}

/// Inserts a new board into the database, associated with a category.
/// Sets the order to be the maximum current order within the category + 1.
pub async fn create_board(
    pool: &PgPool,
    category_id: Uuid,
    board_data: CreateBoardData,
) -> Result<Board, sqlx::Error> {
    // Fetch the current max order + 1 for this specific category, or 0 if no boards exist
    let next_order: i32 = sqlx::query_scalar!(
        r#"SELECT COALESCE(MAX("order") + 1, 0) FROM boards WHERE category_id = $1"#,
        category_id
    )
    .fetch_one(pool)
    .await?
    .expect("COALESCE should guarantee a non-NULL value");

    let new_board = sqlx::query_as!(
        Board,
        r#"
        INSERT INTO boards (category_id, name, description, "order")
        VALUES ($1, $2, $3, $4)
        RETURNING id, category_id, name, description, created_at, "order"
        "#,
        category_id,
        board_data.name,
        board_data.description,
        next_order // Set the order for the new board within its category
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
        SELECT id, category_id, name, description, created_at, "order"
        FROM boards
        WHERE id = $1
        "#,
        board_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(board)
}

/// Fetches all boards belonging to a specific category with pagination, ordered by the "order" column.
pub async fn get_boards_by_category(
    pool: &PgPool,
    category_id: Uuid,
    pagination: &PaginationParams,
) -> Result<Vec<Board>, sqlx::Error> {
    let boards = sqlx::query_as!(
        Board,
        r#"
        SELECT id, category_id, name, description, created_at, "order"
        FROM boards
        WHERE category_id = $1
        ORDER BY "order" ASC -- Order by the new order column
        LIMIT $2 OFFSET $3
        "#,
        category_id,
        pagination.limit() as i64,
        pagination.offset() as i64
    )
    .fetch_all(pool)
    .await?;
    Ok(boards)
}

// Input data for updating a board (order is not updated here)
#[derive(serde::Deserialize, Debug)]
pub struct UpdateBoardData {
    pub name: String,
    pub description: String,
    pub category_id: Option<Uuid>,
}

/// Updates an existing board's name, description, and optionally category_id. Does not change order.
pub async fn update_board(
    pool: &PgPool,
    board_id: Uuid,
    update_data: UpdateBoardData,
) -> Result<Option<Board>, sqlx::Error> {
    // Build the SET part of the query dynamically based on whether category_id is present
    let mut set_clauses = vec!["name = $1", "description = $2"];
    if update_data.category_id.is_some() {
        set_clauses.push("category_id = $4");
    }
    let set_query_part = set_clauses.join(", ");

    // Construct the full query string
    // Note: RETURNING clause needs all fields from the Board struct
    let query_str = format!(
        "UPDATE boards SET {} WHERE id = $3 RETURNING id, category_id, name, description, created_at, \"order\"",
        set_query_part
    );

    // Prepare the query - use query_as for mapping to Board struct
    let mut query = sqlx::query_as::<_, Board>(&query_str)
        .bind(&update_data.name)
        .bind(&update_data.description)
        .bind(board_id);

    // Bind category_id only if it's Some
    if let Some(cat_id) = update_data.category_id {
        query = query.bind(cat_id);
    }

    // Execute the query
    let updated_board = query.fetch_optional(pool).await?;

    Ok(updated_board)
}

/// Updates the order of multiple boards based on a provided list of IDs.
/// Assumes all provided IDs belong to the same category implicitly.
/// For stronger safety, you could add a category_id parameter and check.
pub async fn update_board_order(pool: &PgPool, ordered_ids: &[Uuid]) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for (index, &board_id) in ordered_ids.iter().enumerate() {
        sqlx::query!(
            r#"UPDATE boards SET "order" = $1 WHERE id = $2"#,
            index as i32,
            board_id
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
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

    // Note: Reordering might be desired after deletion, handled separately
    Ok(result.rows_affected())
} 