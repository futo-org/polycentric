pub mod auth;
pub mod dm;
pub mod keys;

use std::sync::Arc;

use crate::config::Config;
use crate::db::DatabaseManager;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<DatabaseManager>,
    pub config: Arc<Config>,
}
