use axum::{
    extract::{MatchedPath, Request},
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::{
    classify::StatusInRangeAsFailures,
    trace::{DefaultOnFailure, DefaultOnResponse, TraceLayer},
};
use tracing::{self as log, info_span, Level};
use tracing_subscriber::EnvFilter;

use dm_server::{
    config::CONFIG,
    db::DatabaseManager,
    handlers::{auth, dm, keys, AppState},
    websocket::{
        connection::handle_websocket_connection, manager::run_websocket_manager, WebSocketManager,
    },
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    log::info!("Starting DM server on port {}", CONFIG.server_port);
    log::info!("WebSocket server on port {}", CONFIG.websocket_port);

    // Connect to database
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(20)
        .connect(&CONFIG.database_url)
        .await?;

    log::info!("Connected to database");

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;
    log::info!("Database migrations completed");

    let db = Arc::new(DatabaseManager::new(pool));
    let ws_manager = WebSocketManager::new();

    let app_state = AppState { db: db.clone() };

    // Create routes
    let routes = create_routes(app_state.clone());

    // Start WebSocket server
    let ws_manager_clone = ws_manager.clone();
    let db_clone = db.clone();
    tokio::spawn(async move {
        start_websocket_server(ws_manager_clone, db_clone).await;
    });

    // Start WebSocket manager background task
    let ws_manager_clone = ws_manager.clone();
    let db_clone = db.clone();
    tokio::spawn(async move {
        run_websocket_manager(ws_manager_clone, db_clone).await;
    });

    // Start message cleanup task
    let db_clone = db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(86400)); // Daily
        loop {
            interval.tick().await;
            match db_clone
                .cleanup_old_messages(CONFIG.message_retention_days)
                .await
            {
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
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", CONFIG.server_port))
        .await
        .expect("Failed to bind HTTP server");

    log::info!("HTTP server listening on port {}", CONFIG.server_port);
    axum::serve(listener, routes)
        .await
        .expect("HTTP server failed");

    Ok(())
}

fn create_routes(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/challenge", get(auth::get_challenge))
        .route("/register_key", post(keys::register_x25519_key))
        .route("/get_key", post(keys::get_x25519_key))
        .route("/send", post(dm::send_dm))
        .route("/history", post(dm::get_dm_history))
        .route("/conversations", get(keys::get_conversations))
        .route(
            "/conversations/detailed",
            get(keys::get_detailed_conversations),
        )
        .route("/mark_read", post(dm::mark_messages_read))
        .with_state(state)
        .layer(
            TraceLayer::new(StatusInRangeAsFailures::new(400..=599).into_make_classifier())
                .make_span_with(|req: &Request<_>| {
                    // Prefer the normalized, router-matched path; fall back to the raw URI path.
                    let matched_path = req
                        .extensions()
                        .get::<MatchedPath>()
                        .map(|p| p.as_str())
                        .unwrap_or_else(|| req.uri().path());

                    info_span!(
                        "http_request",
                        method = %req.method(),
                        uri = %req.uri(),
                        matched_path,            // <-- the endpoint being hit
                        version = ?req.version(),
                    )
                })
                .on_response(DefaultOnResponse::new().level(Level::INFO))
                .on_failure(DefaultOnFailure::new().level(Level::ERROR)),
        )
}

async fn health_handler() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({"status": "ok"}))
}

async fn start_websocket_server(ws_manager: WebSocketManager, db: Arc<DatabaseManager>) {
    let listener = TcpListener::bind(format!("0.0.0.0:{}", CONFIG.websocket_port))
        .await
        .expect("Failed to bind WebSocket server");

    log::info!(
        "WebSocket server listening on port {}",
        CONFIG.websocket_port
    );

    while let Ok((stream, addr)) = listener.accept().await {
        log::debug!("New WebSocket connection from {}", addr);

        let ws_manager = ws_manager.clone();
        let db = db.clone();

        tokio::spawn(async move {
            match tokio_tungstenite::accept_async(stream).await {
                Ok(websocket) => {
                    handle_websocket_connection(websocket, ws_manager, db).await;
                }
                Err(e) => {
                    log::error!("WebSocket connection failed: {}", e);
                }
            }
        });
    }
}
