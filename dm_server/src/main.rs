use std::sync::Arc;
use tokio::net::TcpListener;
use warp::Filter;

use dm_server::{
    config::Config,
    db::DatabaseManager,
    handlers::{auth, dm, keys, AppState},
    websocket::{connection::handle_websocket_connection, manager::run_websocket_manager, WebSocketManager},
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
        ).await;
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
        ).await;
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
    warp::serve(routes)
        .run(([0, 0, 0, 0], config.server_port))
        .await;

    Ok(())
}

fn create_routes(
    state: AppState,
) -> impl Filter<Extract = impl warp::Reply> + Clone {
    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type", "authorization"])
        .allow_methods(&[warp::http::Method::GET, warp::http::Method::POST]);

    // Health check
    let health = warp::path("health")
        .and(warp::path::end())
        .map(|| warp::reply::json(&serde_json::json!({"status": "ok"})));

    // Authentication challenge
    let challenge = warp::path("challenge")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(state.clone()))
        .and_then(auth::get_challenge);

    // X25519 key registration
    let register_key = warp::path("register_key")
        .and(warp::path::end())
        .and(warp::post())
        .and(auth::with_auth(state.clone()))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .and_then(keys::register_x25519_key);

    // Get X25519 key
    let get_key = warp::path("get_key")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .and_then(keys::get_x25519_key);

    // Send DM
    let send_dm = warp::path("send")
        .and(warp::path::end())
        .and(warp::post())
        .and(auth::with_auth(state.clone()))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .and_then(dm::send_dm);

    // Get DM history
    let get_history = warp::path("history")
        .and(warp::path::end())
        .and(warp::post())
        .and(auth::with_auth(state.clone()))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .and_then(dm::get_dm_history);

    // Get conversations
    let get_conversations = warp::path("conversations")
        .and(warp::path::end())
        .and(warp::get())
        .and(auth::with_auth(state.clone()))
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(with_state(state.clone()))
        .and_then(|identity, query: std::collections::HashMap<String, String>, state| {
            let limit = query.get("limit").and_then(|s| s.parse().ok());
            keys::get_conversations(identity, limit, state)
        });

    // Mark messages as read
    let mark_read = warp::path("mark_read")
        .and(warp::path::end())
        .and(warp::post())
        .and(auth::with_auth(state.clone()))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .and_then(|identity, message_ids: Vec<String>, state| {
            dm::mark_messages_read(identity, message_ids, state)
        });

    health
        .or(challenge)
        .or(register_key)
        .or(get_key)
        .or(send_dm)
        .or(get_history)
        .or(get_conversations)
        .or(mark_read)
        .with(cors)
        .recover(auth::handle_auth_error)
}

fn with_state(
    state: AppState,
) -> impl Filter<Extract = (AppState,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || state.clone())
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
