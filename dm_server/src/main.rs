use axum::{
    http::Method,
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

use dm_server::{
    config::Config,
    db::DatabaseManager,
    handlers::{auth, dm, keys, AppState},
    websocket::{
        connection::handle_websocket_connection, manager::run_websocket_manager, WebSocketManager,
    },
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();

    // Load configuration
    let config = Arc::new(Config::from_env()?);
    log::info!("Starting DM server on port {}", config.server_port);
    log::info!("WebSocket server on port {}", config.websocket_port);

    // Connect to database
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;

    log::info!("Connected to database");

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;
    log::info!("Database migrations completed");

    let db = Arc::new(DatabaseManager::new(pool));
    let ws_manager = WebSocketManager::new();

    let app_state = AppState {
        db: db.clone(),
        config: config.clone(),
    };

    // Create routes
    let routes = create_routes(app_state.clone());

    // Start WebSocket server
    let ws_manager_clone = ws_manager.clone();
    let db_clone = db.clone();
    let config_clone = config.clone();
    tokio::spawn(async move {
        start_websocket_server(
            config_clone.websocket_port,
            ws_manager_clone,
            db_clone,
            config_clone.challenge_key.clone(),
        )
        .await;
    });

    // Start WebSocket manager background task
    let ws_manager_clone = ws_manager.clone();
    let db_clone = db.clone();
    let cleanup_interval = config.cleanup_interval_seconds;
    let connection_timeout = config.connection_timeout_seconds;
    tokio::spawn(async move {
        run_websocket_manager(
            ws_manager_clone,
            db_clone,
            cleanup_interval,
            connection_timeout,
        )
        .await;
    });

    // Start message cleanup task
    let db_clone = db.clone();
    let retention_days = config.message_retention_days;
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(86400)); // Daily
        loop {
            interval.tick().await;
            match db_clone.cleanup_old_messages(retention_days).await {
                Ok(count) => {
                    if count > 0 {
                        log::info!("Cleaned up {} old messages", count);
                    }
                }
                Err(e) => {
                    log::error!("Failed to cleanup old messages: {}", e);
                }
            }
        }
    });

    // Start HTTP server
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.server_port))
        .await
        .expect("Failed to bind HTTP server");

    log::info!("HTTP server listening on port {}", config.server_port);
    axum::serve(listener, routes)
        .await
        .expect("HTTP server failed");

    Ok(())
}

fn create_routes(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
        ])
        .allow_methods([Method::GET, Method::POST]);

    Router::new()
        .route("/health", get(health_handler))
        .route("/challenge", get(auth::get_challenge))
        .route("/register_key", post(keys::register_x25519_key))
        .route("/get_key", post(keys::get_x25519_key))
        .route("/send", post(dm::send_dm))
        .route("/history", post(dm::get_dm_history))
        .route("/conversations", get(keys::get_conversations))
        .route("/mark_read", post(dm::mark_messages_read))
        .layer(cors)
        .with_state(state)
}

async fn health_handler() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({"status": "ok"}))
}

async fn start_websocket_server(
    port: u16,
    ws_manager: WebSocketManager,
    db: Arc<DatabaseManager>,
    challenge_key: String,
) {
    let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .expect("Failed to bind WebSocket server");

    log::info!("WebSocket server listening on port {}", port);

    while let Ok((stream, addr)) = listener.accept().await {
        log::debug!("New WebSocket connection from {}", addr);

        let ws_manager = ws_manager.clone();
        let db = db.clone();
        let challenge_key = challenge_key.clone();

        tokio::spawn(async move {
            match tokio_tungstenite::accept_async(stream).await {
                Ok(websocket) => {
                    handle_websocket_connection(websocket, ws_manager, db, challenge_key).await;
                }
                Err(e) => {
                    log::error!("WebSocket connection failed: {}", e);
                }
            }
        });
    }
}
