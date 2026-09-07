use crate::config;
use moderation_migration::{Migrator, MigratorTrait};
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbErr};
use std::time::Duration;

/// Returns read-write and read-only database connection pools.
///
/// Connects to Postgres with the moderation schema as the search path, creating
/// the schema if it does not yet exist.
pub async fn connect() -> Result<(DatabaseConnection, DatabaseConnection), DbErr> {
    let config = config::get();
    let schema = &config.database_schema;
    let max = config.database_max_connections;

    let db = create_pool("moderation-rw", &config.database_url, max, schema).await?;

    db.execute_unprepared(&format!("CREATE SCHEMA IF NOT EXISTS \"{schema}\""))
        .await?;

    let ro_db = if let Some(url) = config.ro_database_url.as_deref() {
        create_pool("moderation-ro", url, max, schema).await?
    } else {
        // If no read-only instance is available reuse the read-write pool.
        db.clone()
    };

    Ok((db, ro_db))
}

async fn create_pool(
    name: &'static str,
    url: &str,
    max: u32,
    schema: &str,
) -> Result<DatabaseConnection, sea_orm::DbErr> {
    let mut opt = ConnectOptions::new(with_utc_timezone(url));
    opt.max_connections(max)
        .min_connections(2)
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .sqlx_logging(false)
        .set_schema_search_path(schema);

    let db = Database::connect(opt).await?;

    common_telemetry::observe_db_pool(name, db.get_postgres_connection_pool().clone());

    Ok(db)
}

pub async fn run_migrations(connection: &DatabaseConnection) -> Result<(), DbErr> {
    Migrator::up(connection, None).await?;
    Ok(())
}

/// Strictly enforce a UTC timezone connection by appending the
/// `options=-c timezone=UTC` parameter.
fn with_utc_timezone(url: &str) -> String {
    if url.contains("timezone") {
        return url.to_string();
    }
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{url}{sep}options=-c%20timezone%3DUTC")
}
