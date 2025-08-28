pub mod auth;
pub mod dm;
pub mod keys;

use std::sync::Arc;
use axum::extract::FromRef;

use crate::config::Config;
use crate::db::DatabaseManager;

/// Shared application state
#[derive(Clone, FromRef)]
pub struct AppState {
    pub db: Arc<DatabaseManager>,
    pub config: Arc<Config>,
}
