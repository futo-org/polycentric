use envconfig::Envconfig;
use serde::{Deserialize, Serialize};

#[derive(Envconfig, Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[envconfig(from = "DATABASE_URL", default = "postgresql://localhost/dm_server")]
    pub database_url: String,

    #[envconfig(from = "DM_SERVER_PORT", default = "8080")]
    pub server_port: u16,

    #[envconfig(from = "DM_WEBSOCKET_PORT", default = "8081")]
    pub websocket_port: u16,

    #[envconfig(from = "DM_CHALLENGE_KEY", default = "change-me-in-production")]
    pub challenge_key: String,

    #[envconfig(from = "DM_MAX_MESSAGE_SIZE", default = "1048576")] // 1MB
    pub max_message_size: usize,

    #[envconfig(from = "DM_MESSAGE_RETENTION_DAYS", default = "30")]
    pub message_retention_days: i32,

    #[envconfig(from = "DM_MAX_CONNECTIONS_PER_USER", default = "5")]
    pub max_connections_per_user: usize,

    #[envconfig(from = "DM_CLEANUP_INTERVAL_SECONDS", default = "3600")] // 1 hour
    pub cleanup_interval_seconds: u64,

    #[envconfig(from = "DM_PING_INTERVAL_SECONDS", default = "30")]
    pub ping_interval_seconds: u64,

    #[envconfig(from = "DM_CONNECTION_TIMEOUT_SECONDS", default = "300")] // 5 minutes
    pub connection_timeout_seconds: u64,

    #[envconfig(from = "RUST_LOG", default = "info")]
    pub log_level: String,
}

impl Config {
    pub fn from_env() -> Result<Self, envconfig::Error> {
        Self::init_from_env()
    }
}
