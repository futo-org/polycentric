// forum_server/src/bin/seed.rs
use dotenvy::dotenv;
use sqlx::postgres::PgPoolOptions;
use std::env;

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

    // Run the shared seeder logic
    forum_server::seeder::seed_database(&pool).await?;

    Ok(())
}
