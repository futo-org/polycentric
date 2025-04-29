use std::net::SocketAddr;
use dotenvy::dotenv;
use sqlx::postgres::PgPoolOptions;
use std::collections::HashSet;
use std::sync::Arc;

// Use the router creation function from the library
use forum_server::{create_router, AppState};

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

    // Load image config
    let image_upload_dir = std::env::var("IMAGE_UPLOAD_DIR")
        .expect("IMAGE_UPLOAD_DIR must be set");
    let image_base_url = std::env::var("IMAGE_BASE_URL")
        .expect("IMAGE_BASE_URL must be set");

    // Ensure upload directory exists
    tokio::fs::create_dir_all(&image_upload_dir).await
        .expect("Failed to create image upload directory");

    // Load admin pubkeys
    let admin_pubkeys_str = std::env::var("ADMIN_PUBKEYS")
        .expect("ADMIN_PUBKEYS environment variable must be set (comma-separated base64)");
    
    let admin_pubkeys_set: HashSet<Vec<u8>> = admin_pubkeys_str
        .split(',')
        .filter_map(|key_b64| {
            // Trim whitespace and decode base64
            let trimmed_key = key_b64.trim();
            if trimmed_key.is_empty() {
                None // Skip empty strings
            } else {
                match base64::decode(trimmed_key) {
                    Ok(key_bytes) => {
                        // Basic length check for Ed25519 keys
                        if key_bytes.len() == 32 {
                           Some(key_bytes)
                        } else {
                            eprintln!("Warning: Invalid admin pubkey length after decoding: {}", trimmed_key);
                            None
                        }
                    }
                    Err(e) => {
                        eprintln!("Warning: Failed to decode admin pubkey '{}': {}", trimmed_key, e);
                        None
                    }
                }
            }
        })
        .collect();

    if admin_pubkeys_set.is_empty() {
        println!("Warning: No valid admin public keys loaded from ADMIN_PUBKEYS.");
    }
    let admin_pubkeys_arc = Arc::new(admin_pubkeys_set);

    // Create the router using the library function, passing config
    let app = create_router(
        db_pool, 
        image_upload_dir.clone(), 
        image_base_url, 
        admin_pubkeys_arc // Pass the admin keys set
    );

    // Define the address and port to run the server on.
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Listening on {}", addr);

    // Run the server.
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
