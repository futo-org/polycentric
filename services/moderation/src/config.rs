//! Moderation service configuration sourced from the environment.

use std::sync::OnceLock;

/// API version for the GA Azure text/image endpoints.
const DEFAULT_AZURE_API_VERSION: &str = "2024-09-01";
/// The multimodal (`imageWithText`) Azure endpoint is preview-only.
const DEFAULT_AZURE_MULTIMODAL_API_VERSION: &str = "2024-09-15-preview";
/// Default PhotoDNA endpoint, also used by the manual PhotoDNA test.
pub(crate) const DEFAULT_PHOTODNA_ENDPOINT: &str =
    "https://api.microsoftmoderator.com/photodna/v1.0";

/// Azure AI Content Safety credentials and API versions.
pub struct AzureConfig {
    /// Resource endpoint (`POLYCENTRIC_AZURE_CONTENT_SAFETY_ENDPOINT`).
    pub endpoint: String,
    /// API key (`POLYCENTRIC_AZURE_CONTENT_SAFETY_KEY`).
    pub key: String,
    /// api-version for the text/image endpoints
    /// (`POLYCENTRIC_AZURE_CONTENT_SAFETY_API_VERSION`).
    pub api_version: String,
    /// api-version for the multimodal endpoint
    /// (`POLYCENTRIC_AZURE_CONTENT_SAFETY_MULTIMODAL_API_VERSION`).
    pub multimodal_api_version: String,
}

pub struct Config {
    /// Postgres connection URL (`DATABASE_URL`).
    pub database_url: String,
    /// Postgres read-only connection URL (`DATABASE_URL_RO`).
    pub ro_database_url: Option<String>,
    /// Schema owning this service's tables
    /// (`POLYCENTRIC_MODERATION_DATABASE_SCHEMA`).
    pub database_schema: String,
    /// Maximum size of the Postgres connection pool
    /// (`POLYCENTRIC_DATABASE_MAX_CONNECTIONS`).
    pub database_max_connections: u32,
    /// Hex 32-byte ed25519 seed labels events are signed with
    /// (`POLYCENTRIC_MODERATION_SIGNING_KEY`).
    pub signing_key: String,
    /// Hex identity string this service publishes under
    /// (`POLYCENTRIC_MODERATION_IDENTITY`).
    pub identity: String,
    /// gRPC server URLs to bootstrap from and publish to
    /// (`POLYCENTRIC_MODERATION_SERVERS`, comma delimited).
    pub servers: Vec<String>,
    /// Azure Content Safety configuration. `None` disables automated
    /// content scoring.
    pub azure: Option<AzureConfig>,
    /// PhotoDNA subscription key (`POLYCENTRIC_PHOTODNA_KEY`). `None`
    /// disables PhotoDNA and the service moderates with Azure alone.
    pub photodna_key: Option<String>,
    /// PhotoDNA endpoint (`POLYCENTRIC_PHOTODNA_ENDPOINT`).
    pub photodna_endpoint: String,
}

static CONFIG: OnceLock<Config> = OnceLock::new();

/// Read and validate the environment into the process-wide [`Config`].
/// Called once at startup, after dotenv load.
pub fn init() -> Result<&'static Config, String> {
    let identity = required("POLYCENTRIC_MODERATION_IDENTITY")?
        .trim()
        .to_string();
    if identity.is_empty() {
        return Err("POLYCENTRIC_MODERATION_IDENTITY is empty".to_string());
    }

    let config = Config {
        database_url: std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres:testing@localhost:5432".to_string()),
        ro_database_url: std::env::var("DATABASE_URL_RO").ok(),
        database_schema: std::env::var("POLYCENTRIC_MODERATION_DATABASE_SCHEMA")
            .unwrap_or_else(|_| "moderation".to_string()),
        database_max_connections: std::env::var("POLYCENTRIC_DATABASE_MAX_CONNECTIONS")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(20),
        signing_key: required("POLYCENTRIC_MODERATION_SIGNING_KEY")?
            .trim()
            .to_string(),
        identity,
        servers: required_list("POLYCENTRIC_MODERATION_SERVERS")?,
        azure: azure_config()?,
        photodna_key: optional("POLYCENTRIC_PHOTODNA_KEY"),
        photodna_endpoint: std::env::var("POLYCENTRIC_PHOTODNA_ENDPOINT")
            .unwrap_or_else(|_| DEFAULT_PHOTODNA_ENDPOINT.to_string()),
    };
    Ok(CONFIG.get_or_init(|| config))
}

/// The startup-validated configuration.
pub fn get() -> &'static Config {
    CONFIG.get().expect("config::init not called")
}

fn azure_config() -> Result<Option<AzureConfig>, String> {
    match (
        optional("POLYCENTRIC_AZURE_CONTENT_SAFETY_ENDPOINT"),
        optional("POLYCENTRIC_AZURE_CONTENT_SAFETY_KEY"),
    ) {
        (Some(endpoint), Some(key)) => Ok(Some(AzureConfig {
            endpoint,
            key,
            api_version: std::env::var("POLYCENTRIC_AZURE_CONTENT_SAFETY_API_VERSION")
                .unwrap_or_else(|_| DEFAULT_AZURE_API_VERSION.to_string()),
            multimodal_api_version: std::env::var(
                "POLYCENTRIC_AZURE_CONTENT_SAFETY_MULTIMODAL_API_VERSION",
            )
            .unwrap_or_else(|_| DEFAULT_AZURE_MULTIMODAL_API_VERSION.to_string()),
        })),
        (None, None) => Ok(None),
        _ => Err("POLYCENTRIC_AZURE_CONTENT_SAFETY_ENDPOINT and \
                  POLYCENTRIC_AZURE_CONTENT_SAFETY_KEY must be set together"
            .to_string()),
    }
}

fn required(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not set"))
}

fn optional(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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
