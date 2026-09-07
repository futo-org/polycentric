//! Server configuration sourced from the environment.

use std::sync::OnceLock;
use std::time::Duration;

pub struct Config {
    /// The canonical URL of this server (`POLYCENTRIC_SERVER_NAME`). Also
    /// stamped as the source on produced Kafka events.
    pub server_name: String,
    /// Accepted auth token audiences (`POLYCENTRIC_ALLOW_HOSTS`, comma
    /// delimited). Defaults to [`Config::server_name`].
    pub allow_hosts: Vec<String>,
    /// Postgres connection URL (`DATABASE_URL`).
    pub database_url: String,
    /// Postgres read-only connection URL (`DATABASE_URL_RO`).
    pub ro_database_url: Option<String>,
    /// Maximum size of the Postgres connection pool
    /// (`POLYCENTRIC_DATABASE_MAX_CONNECTIONS`).
    pub database_max_connections: u32,
    /// Public URL clients use to fetch blob bodies (`CDN_URL`).
    pub cdn_url: String,
    /// Base URL of the internal scraper service (`POLYCENTRIC_SCRAPER_URL`).
    pub scraper_url: String,
    /// Hex identity string of the trusted moderation service
    /// (`POLYCENTRIC_MODERATION_IDENTITY`). `None` means no content labels.
    pub trusted_moderator: Option<String>,
    /// Gravity constant used in the reaction_count_decay function.
    ///
    /// Essentially the higher the number the larger the impact of the decay.
    ///
    /// If this is set it overwrite the usage of dynamic gravity. If this is not
    /// set the dynamic gravity is used, see
    /// `dynamic_feeds_gravity_per_reaction`.
    pub feeds_gravity: Option<f64>,
    /// Dynamic gravity per reaction.
    ///
    /// This is used in computing the dynamic gravity value, using the formula:
    /// `G = #R * feeds_gravity_per_reaction`. Where G is the computed gravity
    /// value and #R is the number of reactions made in the last
    /// `dynamic_feeds_gravity_hours` hours.
    ///
    /// If `feeds_gravity` is set dynamic gravity is ignored (including this
    /// setting).
    pub dynamic_feeds_gravity_per_reaction: f64,
    /// The number of hours in which to consider the reactions to compute the
    /// dynamic gravity value. See `dynamic_feeds_gravity_per_reaction`.
    pub dynamic_feeds_gravity_hours: usize,
    /// How often the decayed reaction counts should be updated.
    pub feed_count_update_frequency: Duration,
}

static CONFIG: OnceLock<Config> = OnceLock::new();

/// Read the environment into the process-wide [`Config`]. Called once at
/// startup, after dotenv load.
pub fn init() -> &'static Config {
    CONFIG.get_or_init(|| {
        let server_name = std::env::var("POLYCENTRIC_SERVER_NAME")
            .unwrap_or_else(|_| "http://localhost:3000".to_string());
        Config {
            allow_hosts: match std::env::var("POLYCENTRIC_ALLOW_HOSTS") {
                Ok(hosts) => hosts
                    .split(',')
                    .map(str::trim)
                    .filter(|host| !host.is_empty())
                    .map(str::to_string)
                    .collect(),
                Err(_) => vec![server_name.clone()],
            },
            database_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://postgres:testing@localhost:5432".to_string()
            }),
            ro_database_url: std::env::var("DATABASE_URL_RO").ok(),
            database_max_connections: std::env::var(
                "POLYCENTRIC_DATABASE_MAX_CONNECTIONS",
            )
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(100),
            cdn_url: std::env::var("CDN_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            scraper_url: std::env::var("POLYCENTRIC_SCRAPER_URL")
                .unwrap_or_else(|_| "http://localhost:8855".to_string()),
            trusted_moderator: std::env::var("POLYCENTRIC_MODERATION_IDENTITY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            feeds_gravity: std::env::var("POLYCENTRIC_FEEDS_GRAVITY")
                .ok()
                .and_then(|s| s.trim().parse().ok()),
            dynamic_feeds_gravity_per_reaction: std::env::var(
                "POLYCENTRIC_FEEDS_GRAVITY_PER_REACTION",
            )
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0.0005),
            dynamic_feeds_gravity_hours: std::env::var(
                "POLYCENTRIC_FEEDS_GRAVITY_HOURS",
            )
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(24),
            feed_count_update_frequency: Duration::from_secs(
                std::env::var(
                    "POLYCENTRIC_FEEDS_GRAVITY_COUNTS_UPDATE_FREQUENCY_SECS",
                )
                .ok()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(5 * 60), // 5 minutes (as seconds).
            ),
            server_name,
        }
    })
}

/// The startup-loaded configuration. Unit tests don't run `main`, so
/// under test this initializes on first use instead.
pub fn get() -> &'static Config {
    #[cfg(test)]
    {
        init()
    }
    #[cfg(not(test))]
    {
        CONFIG.get().expect("config::init not called")
    }
}
