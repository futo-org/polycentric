use std::net::SocketAddr;
use dotenvy::dotenv;
use sqlx::postgres::PgPoolOptions;

// Use the router creation function from the library
use forum_server::create_router;

#[tokio::main]
async fn main() {
    // Load environment variables from .env file
    dotenv().ok();

    // Get database URL from environment
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    // Create database connection pool
    let db_pool = PgPoolOptions::new()
        .max_connections(5) // Configure pool size as needed
        .connect(&database_url)
        .await
        .expect("Failed to create database pool.");

    println!("Database connection pool established.");

    // Create the router using the library function
    let app = create_router(db_pool);

    // Define the address and port to run the server on.
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Listening on {}", addr);

    // Run the server.
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
