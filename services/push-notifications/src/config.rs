//! Push-notifications service configuration sourced from the environment.

use std::net::SocketAddr;
use std::sync::OnceLock;

pub struct Config {
    /// Postgres connection URL (`DATABASE_URL`).
    pub database_url: String,
    /// Postgres read-only connection URL (`DATABASE_URL_RO`).
    pub ro_database_url: Option<String>,
    /// Schema owning this service's tables
    /// (`POLYCENTRIC_NOTIFICATIONS_DATABASE_SCHEMA`).
    pub database_schema: String,
    /// Maximum size of the Postgres connection pool
    /// (`POLYCENTRIC_DATABASE_MAX_CONNECTIONS`).
    pub database_max_connections: u32,
    /// Expo access token (`EXPO_ACCESS_TOKEN`). Blank is treated as unset —
    /// Expo rejects an empty bearer token but accepts no auth header.
    pub expo_access_token: Option<String>,
    /// The server events must originate from for this service to fire
    /// notifications (`POLYCENTRIC_MAIN_SERVER`).
    pub main_server: String,
    /// Address the gRPC `NotificationService` listens on
    /// (`POLYCENTRIC_NOTIFICATIONS_GRPC_ADDR`).
    pub grpc_addr: SocketAddr,
    /// gRPC server URLs to query for identity data
    /// (`POLYCENTRIC_QUERY_SERVERS`, comma delimited).
    pub query_servers: Vec<String>,
}

static CONFIG: OnceLock<Config> = OnceLock::new();

/// Read and validate the environment into the process-wide [`Config`].
/// Called once at startup, after dotenv load.
pub fn init() -> Result<&'static Config, String> {
    let config = Config {
        database_url: std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres:testing@localhost:5432".to_string()),
        ro_database_url: std::env::var("DATABASE_URL_RO").ok(),
        database_schema: std::env::var("POLYCENTRIC_NOTIFICATIONS_DATABASE_SCHEMA")
            .unwrap_or_else(|_| "notifications".to_string()),
        database_max_connections: std::env::var("POLYCENTRIC_DATABASE_MAX_CONNECTIONS")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(20),
        expo_access_token: std::env::var("EXPO_ACCESS_TOKEN")
            .ok()
            .filter(|t| !t.is_empty()),
        main_server: required("POLYCENTRIC_MAIN_SERVER")?,
        grpc_addr: std::env::var("POLYCENTRIC_NOTIFICATIONS_GRPC_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:3001".to_string())
            .parse()
            .map_err(|e| format!("POLYCENTRIC_NOTIFICATIONS_GRPC_ADDR: {e}"))?,
        query_servers: required_list("POLYCENTRIC_QUERY_SERVERS")?,
    };
    Ok(CONFIG.get_or_init(|| config))
}

/// The startup-validated configuration.
pub fn get() -> &'static Config {
    CONFIG.get().expect("config::init not called")
}

fn required(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not set"))
}

/// A required comma-delimited list; must contain at least one entry.
fn required_list(name: &str) -> Result<Vec<String>, String> {
    let items: Vec<String> = required(name)?
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if items.is_empty() {
        return Err(format!("{name} is empty"));
    }
    Ok(items)
}
