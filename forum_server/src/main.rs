use std::net::SocketAddr;
use dotenvy::dotenv;
use sqlx::postgres::PgPoolOptions;
use std::collections::HashSet;
use std::sync::Arc;

use forum_server::{create_router, AppState};

#[tokio::main]
async fn main() {
    dotenv().ok();

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let db_pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .expect("Failed to create database pool.");

    println!("Database connection pool established.");

    let image_upload_dir = std::env::var("IMAGE_UPLOAD_DIR")
        .expect("IMAGE_UPLOAD_DIR must be set");
    let image_base_url = std::env::var("IMAGE_BASE_URL")
        .expect("IMAGE_BASE_URL must be set");

    tokio::fs::create_dir_all(&image_upload_dir).await
        .expect("Failed to create image upload directory");

    let admin_pubkeys_str = std::env::var("ADMIN_PUBKEYS")
        .expect("ADMIN_PUBKEYS environment variable must be set (comma-separated base64)");
    
    let admin_pubkeys_set: HashSet<Vec<u8>> = admin_pubkeys_str
        .split(',')
        .filter_map(|key_b64| {
            let trimmed_key = key_b64.trim();
            if trimmed_key.is_empty() {
                None
            } else {
                match base64::decode(trimmed_key) {
                    Ok(key_bytes) => {
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

    let app = create_router(
        db_pool, 
        image_upload_dir.clone(), 
        image_base_url, 
        admin_pubkeys_arc
    );

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000)); 
    println!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
