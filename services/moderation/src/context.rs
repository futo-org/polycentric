use common_object_store::ObjectStore;
use sea_orm::DatabaseConnection;

use crate::{
    polycentric::PolycentricClient,
    providers::{azure::AzureClient, photodna::PhotoDnaClient},
};

/// Shared service dependencies threaded through message processing.
pub struct Context {
    /// Read/write database connection pool.
    pub db: DatabaseConnection,
    /// Read-only database connection pool.
    pub ro_db: DatabaseConnection,
    /// Azure moderation client. If `None`, ignored.
    pub azure: Option<AzureClient>,
    /// PhotoDNA CSAM client. If `None`, ignored.
    pub photodna: Option<PhotoDnaClient>,
    /// Blob store for fetching image content.
    pub blobs: ObjectStore,
    /// Polycentric client (to talk to other polycentric servers)
    pub polycentric: PolycentricClient,
}
