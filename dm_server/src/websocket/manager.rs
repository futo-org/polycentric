use std::sync::Arc;
use tokio::time::{interval, Duration};
use tracing as log;

use super::WebSocketManager;
use crate::{config::CONFIG, db::DatabaseManager};

/// Background task to manage WebSocket connections
pub async fn run_websocket_manager(ws_manager: WebSocketManager, db: Arc<DatabaseManager>) {
    let mut cleanup_interval = interval(Duration::from_secs(CONFIG.cleanup_interval_seconds));

    loop {
        cleanup_interval.tick().await;

        // Clean up stale connections in database
        match db
            .cleanup_stale_connections(CONFIG.connection_timeout_seconds as i64)
            .await
        {
            Ok(count) => {
                if count > 0 {
                    log::info!("Cleaned up {} stale database connections", count);
                }
            }
            Err(e) => {
                log::error!("Failed to cleanup stale connections: {}", e);
            }
        }

        // Log connection statistics
        let (total_connections, unique_users) = ws_manager.get_stats().await;
        log::debug!(
            "WebSocket stats: {} connections, {} unique users",
            total_connections,
            unique_users
        );
    }
}
