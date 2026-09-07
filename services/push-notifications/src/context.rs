use crate::manager::NotificationManager;
use crate::polycentric::PolycentricClient;
use sea_orm::DatabaseConnection;

/// Shared service dependencies threaded through message processing.
pub struct Context {
    /// Read/write database connection pool.
    pub db: DatabaseConnection,
    /// Read-only database connection pool.
    pub ro_db: DatabaseConnection,
    /// Notification manager (handles notification send logic)
    pub notification_manager: NotificationManager,
    /// Read-only client for fetching identity data (e.g. display names)
    /// from polycentric servers over gRPC.
    pub polycentric: PolycentricClient,
    /// The polycentric server this service expects
    /// events to originate from.
    pub main_server: String,
}
