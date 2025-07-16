// forum_server/src/bin/seed.rs
use dotenvy::dotenv;
use sqlx::postgres::PgPoolOptions;
use sqlx::Executor;
use std::env;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    println!("[Seed Script] Starting database seeding...");

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set for seeding");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;

    println!("[Seed Script] Connected to database.");

    println!("[Seed Script] Seeding categories...");

    let cat1_name = "General Discussion";
    let cat1_desc = "Talk about anything!";
    pool.execute(sqlx::query(
        "INSERT INTO categories (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING")
        .bind(cat1_name).bind(cat1_desc)
    ).await?;
    let cat1_id: Uuid = sqlx::query_scalar("SELECT id FROM categories WHERE name = $1")
        .bind(cat1_name)
        .fetch_one(&pool)
        .await?;
    println!("  - Ensured 'General Discussion' (ID: {})", cat1_id);

    let cat2_name = "Technical Support";
    let cat2_desc = "Get help with technical issues.";
    pool.execute(sqlx::query(
        "INSERT INTO categories (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING")
        .bind(cat2_name).bind(cat2_desc)
    ).await?;
    let cat2_id: Uuid = sqlx::query_scalar("SELECT id FROM categories WHERE name = $1")
        .bind(cat2_name)
        .fetch_one(&pool)
        .await?;
    println!("  - Ensured 'Technical Support' (ID: {})", cat2_id);

    println!("[Seed Script] Seeding boards...");
    pool.execute(sqlx::query(
        "INSERT INTO boards (category_id, name, description) VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO NOTHING")
        .bind(cat1_id).bind("Introductions").bind("Introduce yourself to the community.")
    ).await?;
    println!("  - Ensured 'Introductions' board in 'General Discussion'");

    pool.execute(sqlx::query(
        "INSERT INTO boards (category_id, name, description) VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO NOTHING")
        .bind(cat1_id).bind("Off-Topic").bind("Random chatter.")
    ).await?;
    println!("  - Ensured 'Off-Topic' board in 'General Discussion'");

    pool.execute(sqlx::query(
         "INSERT INTO boards (category_id, name, description) VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO NOTHING")
         .bind(cat2_id).bind("Bug Reports").bind("Report software bugs here.")
    ).await?;
    println!("  - Ensured 'Bug Reports' board in 'Technical Support'");

    println!("[Seed Script] Database seeding completed successfully.");
    Ok(())
}
