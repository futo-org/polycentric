use base64::{engine::general_purpose::STANDARD, Engine};
use dotenvy::dotenv;
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc; // For simple scalar query

use axum::Router;
use forum_server::config::ForumServerConfig;
use forum_server::create_router;

#[tokio::main]
async fn main() {
    dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let db_pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .expect("Failed to create database pool.");

    println!("Database connection pool established.");

    // Ensure critical columns exist (backward-compat for older DBs)
    if let Err(e) = sqlx::query(
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS \"order\" INTEGER NOT NULL DEFAULT 0;",
    )
    .execute(&db_pool)
    .await
    {
        eprintln!(
            "Warning: could not add 'order' column to categories: {:?}",
            e
        );
    }

    if let Err(e) = sqlx::query(
        "ALTER TABLE boards ADD COLUMN IF NOT EXISTS \"order\" INTEGER NOT NULL DEFAULT 0;",
    )
    .execute(&db_pool)
    .await
    {
        eprintln!("Warning: could not add 'order' column to boards: {:?}", e);
    }

    // --------------------------------------------------------------------
    // Check if the database needs to be seeded
    // --------------------------------------------------------------------
    match sqlx::query("SELECT COUNT(*) as count FROM categories")
        .fetch_one(&db_pool)
        .await
    {
        Ok(row) => {
            let count: i64 = row.get::<i64, _>("count");
            if count == 0 {
                println!("No categories detected – running database seeder...");
                if let Err(e) = forum_server::seeder::seed_database(&db_pool).await {
                    eprintln!("Failed to seed database: {:?}", e);
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to query category count: {:?}", e);
        }
    }

    // Determine whether image uploads are enabled *before* we fetch the related
    // environment variables so we don’t require them when uploads are disabled.
    let image_uploads_enabled = std::env::var("ENABLE_FORUM_IMAGE_UPLOADS")
        .map(|v| {
            let v_lower = v.to_lowercase();
            v_lower == "1" || v_lower == "true" || v_lower == "yes"
        })
        .unwrap_or(false);

    let image_upload_dir = if image_uploads_enabled {
        std::env::var("IMAGE_UPLOAD_DIR")
            .expect("IMAGE_UPLOAD_DIR must be set when ENABLE_FORUM_IMAGE_UPLOADS is enabled")
    } else {
        std::env::var("IMAGE_UPLOAD_DIR").unwrap_or_else(|_| "/tmp/forum_server_uploads".into())
    };

    let image_base_url = if image_uploads_enabled {
        std::env::var("IMAGE_BASE_URL")
            .expect("IMAGE_BASE_URL must be set when ENABLE_FORUM_IMAGE_UPLOADS is enabled")
    } else {
        std::env::var("IMAGE_BASE_URL").unwrap_or_else(|_| "/uploads/images".into())
    };

    if image_uploads_enabled {
        tokio::fs::create_dir_all(&image_upload_dir)
            .await
            .expect("Failed to create image upload directory");
    } else {
        println!("Forum image uploads are disabled; skipping image directory setup.");
    }

    let admin_pubkeys_str = std::env::var("ADMIN_PUBKEYS")
        .expect("ADMIN_PUBKEYS environment variable must be set (comma-separated base64)");

    let admin_pubkeys_set: HashSet<Vec<u8>> = admin_pubkeys_str
        .split(',')
        .filter_map(|key_b64| {
            let trimmed_key = key_b64.trim();
            if trimmed_key.is_empty() {
                None
            } else {
                match STANDARD.decode(trimmed_key) {
                    Ok(key_bytes) => {
                        if key_bytes.len() == 32 {
                            Some(key_bytes)
                        } else {
                            eprintln!(
                                "Warning: Invalid admin pubkey length after decoding: {}",
                                trimmed_key
                            );
                            None
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "Warning: Failed to decode admin pubkey '{}': {}",
                            trimmed_key, e
                        );
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

    // Load server configuration
    let server_name =
        std::env::var("FORUM_SERVER_NAME").unwrap_or_else(|_| "Default Forum Name".to_string());
    let server_image_url = std::env::var("FORUM_SERVER_IMAGE_URL").ok();

    let config = ForumServerConfig::new(server_name, server_image_url);

    // DEBUG: Print loaded admin pubkeys in base64
    println!(
        "Loaded admin pubkeys: {:?}",
        admin_pubkeys_arc
            .iter()
            .map(|k| base64::engine::general_purpose::STANDARD.encode(k))
            .collect::<Vec<_>>()
    );

    let api_router = create_router(
        db_pool,
        image_upload_dir.clone(),
        image_base_url,
        admin_pubkeys_arc,
        image_uploads_enabled,
        config,
    );

    let app = Router::new()
        .nest("/api", api_router.clone())
        .nest("/forum", api_router.clone())
        .merge(api_router);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    println!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
