pub mod auth;
pub mod dm;
pub mod keys;

use axum::extract::FromRef;
use std::sync::Arc;

use crate::config::Config;
use crate::db::DatabaseManager;

/// Shared application state
#[derive(Clone, FromRef)]
pub struct AppState {
    pub db: Arc<DatabaseManager>,
    pub config: Arc<Config>,
}
