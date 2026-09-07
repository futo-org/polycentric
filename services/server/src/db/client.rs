use std::time::Duration;

use sea_orm::{ConnectOptions, Database, DatabaseConnection};

use crate::config;

/// Returns read-write and read-only database connection pools.
///
/// With `durable_commits` off connections run `synchronous_commit=off`;
/// only for the workers, whose writes are caches rebuilt by Kafka replay.
pub async fn build_db_clients(
    durable_commits: bool,
) -> Result<(DatabaseConnection, DatabaseConnection), sea_orm::DbErr> {
    let config = config::get();
    let max = config.database_max_connections;

    let db =
        create_pool("server-rw", &config.database_url, max, durable_commits)
            .await?;

    let ro_db = if let Some(url) = config.ro_database_url.as_deref() {
        create_pool("server-ro", url, max, durable_commits).await?
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
    durable_commits: bool,
) -> Result<DatabaseConnection, sea_orm::DbErr> {
    let mut opt =
        ConnectOptions::new(with_connection_options(url, durable_commits));
    opt.max_connections(max)
        .min_connections(5)
        .connect_timeout(Duration::from_secs(8))
        .acquire_timeout(Duration::from_secs(8))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .sqlx_logging(false)
        .set_schema_search_path("public");

    let db = Database::connect(opt).await?;

    common_telemetry::observe_db_pool(
        name,
        db.get_postgres_connection_pool().clone(),
    );

    Ok(db)
}

/// Append startup parameters: a strict UTC timezone, plus asynchronous
/// commits when `durable_commits` is off. Existing `options=` are kept.
fn with_connection_options(url: &str, durable_commits: bool) -> String {
    if url.contains("options=") {
        return url.to_string();
    }
    let mut options = String::from("-c%20timezone%3DUTC");
    if !durable_commits {
        options.push_str("%20-c%20synchronous_commit%3Doff");
    }
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{url}{sep}options={options}")
}
