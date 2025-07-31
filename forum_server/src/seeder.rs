use sqlx::{Executor, PgPool};
use uuid::Uuid;

/// Seed the database with initial categories and boards.
///
/// This function is idempotent – it uses `ON CONFLICT DO NOTHING`
/// so it can safely be run multiple times.
pub async fn seed_database(pool: &PgPool) -> Result<(), sqlx::Error> {
    println!("[Seeder] Seeding categories...");

    // --- Categories -------------------------------------------------------
    let cat1_name = "General Discussion";
    let cat1_desc = "Talk about anything!";
    pool.execute(sqlx::query(
        "INSERT INTO categories (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
    )
    .bind(cat1_name)
    .bind(cat1_desc))
        .await?;
    let cat1_id: Uuid = sqlx::query_scalar("SELECT id FROM categories WHERE name = $1")
        .bind(cat1_name)
        .fetch_one(pool)
        .await?;
    println!("  - Ensured 'General Discussion' (ID: {})", cat1_id);

    let cat2_name = "Technical Support";
    let cat2_desc = "Get help with technical issues.";
    pool.execute(sqlx::query(
        "INSERT INTO categories (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
    )
    .bind(cat2_name)
    .bind(cat2_desc))
        .await?;
    let cat2_id: Uuid = sqlx::query_scalar("SELECT id FROM categories WHERE name = $1")
        .bind(cat2_name)
        .fetch_one(pool)
        .await?;
    println!("  - Ensured 'Technical Support' (ID: {})", cat2_id);

    // --- Boards -----------------------------------------------------------
    println!("[Seeder] Seeding boards...");
    pool.execute(sqlx::query(
        "INSERT INTO boards (category_id, name, description) VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO NOTHING",
    )
    .bind(cat1_id)
    .bind("Introductions")
    .bind("Introduce yourself to the community."))
        .await?;
    println!("  - Ensured 'Introductions' board in 'General Discussion'");

    pool.execute(sqlx::query(
        "INSERT INTO boards (category_id, name, description) VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO NOTHING",
    )
    .bind(cat1_id)
    .bind("Off-Topic")
    .bind("Random chatter."))
        .await?;
    println!("  - Ensured 'Off-Topic' board in 'General Discussion'");

    pool.execute(sqlx::query(
        "INSERT INTO boards (category_id, name, description) VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO NOTHING",
    )
    .bind(cat2_id)
    .bind("Bug Reports")
    .bind("Report software bugs here."))
        .await?;
    println!("  - Ensured 'Bug Reports' board in 'Technical Support'");

    println!("[Seeder] Database seeding completed successfully.");
    Ok(())
}
