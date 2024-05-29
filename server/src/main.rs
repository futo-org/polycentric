use ::anyhow::Context;
use ::cadence::{StatsdClient, UdpMetricSink};
use ::envconfig::Envconfig;
use ::log::*;
use ::std::net::UdpSocket;
use ::warp::Filter;

mod handlers;
mod ingest;
mod migrate;
mod model;
mod opensearch;
mod postgres;
mod queries;
mod version;

include!(concat!(env!("OUT_DIR"), "/protos/mod.rs"));

#[macro_export]
macro_rules! warp_try_err_500 {
    ($expr:expr) => {
        match $expr {
            Ok(x) => x,
            Err(err) => {
                ::log::warn!("HTTP 500 {}", err.to_string().clone());
                return Ok(Box::new(::warp::reply::with_status(
                    err.to_string().clone(),
                    ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                )));
            }
        }
    };
}

#[macro_export]
macro_rules! warp_try_err_400 {
    ($expr:expr) => {
        match $expr {
            Ok(x) => x,
            Err(err) => {
                ::log::warn!("HTTP 400 {}", err.to_string().clone());
                return Ok(Box::new(::warp::reply::with_status(
                    err.to_string().clone(),
                    ::warp::http::StatusCode::BAD_REQUEST,
                )));
            }
        }
    };
}

struct State {
    pool: ::sqlx::PgPool,
    deadpool_write: ::deadpool_postgres::Pool,
    pool_read_only: ::sqlx::PgPool,
    search: ::opensearch::OpenSearch,
    admin_token: String,
    statsd_client: ::cadence::StatsdClient,
    challenge_key: String,
    ingest_cache:
        ::std::sync::Mutex<::lru::LruCache<crate::model::pointer::Pointer, ()>>,
}

async fn handle_rejection(
    err: ::warp::Rejection,
) -> Result<impl ::warp::Reply, ::std::convert::Infallible> {
    info!("rejection A: {:?}", err);

    if err.is_not_found() {
        return Ok(::warp::reply::with_status(
            "Not Found",
            ::warp::http::StatusCode::NOT_FOUND,
        ));
    } else if err.find::<::warp::reject::MethodNotAllowed>().is_some() {
        return Ok(::warp::reply::with_status(
            "Method Not Allowed",
            ::warp::http::StatusCode::BAD_REQUEST,
        ));
    }

    Ok(::warp::reply::with_status(
        "INTERNAL_SERVER_ERROR",
        ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
    ))
}

#[derive(::serde::Deserialize, ::serde::Serialize)]
struct OpenSearchSearchDocumentMessage {
    author_public_key: String,
    writer_id: String,
    sequence_number: i64,
    message: Option<String>,
}

#[derive(::serde::Deserialize, ::serde::Serialize)]
struct OpenSearchSearchDocumentProfile {
    author_public_key: String,
    writer_id: String,
    sequence_number: i64,
    profile_name: String,
    profile_description: Option<String>,
    unix_milliseconds: u64,
}

#[derive(::serde::Deserialize, ::serde::Serialize)]
struct OpenSearchContent {
    message_content: String,
    // only serialize when it's not None
    #[serde(skip_serializing_if = "Option::is_none")]
    unix_milliseconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    byte_reference: Option<String>,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchHitsL2 {
    _source: OpenSearchContent,
    _id: String,
    _index: String,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchHitsL1 {
    hits: ::std::vec::Vec<OpenSearchSearchHitsL2>,
}

#[derive(::serde::Deserialize)]
struct OpenSearchAggregationBucketL3 {
    key: String,
    doc_count: i64,
}

#[derive(::serde::Deserialize)]
struct OpenSearchAggregationsL2 {
    buckets: ::std::vec::Vec<OpenSearchAggregationBucketL3>,
}

#[derive(::serde::Deserialize)]
struct OpenSearchAggregationsL1 {
    top_byte_references: Option<OpenSearchAggregationsL2>,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchL0 {
    hits: Option<OpenSearchSearchHitsL1>,
    aggregations: Option<OpenSearchAggregationsL1>,
}

enum Mode {
    ServeAPI,
    BackfillSearch,
    BackfillRemoteServer,
}

impl ::std::str::FromStr for Mode {
    type Err = ();

    fn from_str(s: &str) -> Result<Mode, ()> {
        match s {
            "SERVE_API" => Ok(Mode::ServeAPI),
            "BACKFILL_SEARCH" => Ok(Mode::BackfillSearch),
            "BACKFILL_REMOTE_SERVER" => Ok(Mode::BackfillRemoteServer),
            _ => Err(()),
        }
    }
}

#[derive(::envconfig::Envconfig)]
struct Config {
    #[envconfig(from = "HTTP_PORT_API", default = "8081")]
    pub http_port_api: u16,

    #[envconfig(
        from = "DATABASE_URL",
        default = "postgres://postgres:testing@postgres"
    )]
    pub postgres_string: String,

    #[envconfig(from = "DATABASE_URL_READ_ONLY")]
    pub postgres_string_read_only: Option<String>,

    #[envconfig(
        from = "OPENSEARCH_STRING",
        default = "http://opensearch-node1:9200"
    )]
    pub opensearch_string: String,

    #[envconfig(from = "ADMIN_TOKEN")]
    pub admin_token: String,

    #[envconfig(from = "STATSD_ADDRESS", default = "telegraf")]
    pub statsd_address: String,

    #[envconfig(from = "STATSD_PORT", default = "8125")]
    pub statsd_port: u16,

    #[envconfig(from = "CHALLENGE_KEY")]
    pub challenge_key: String,

    #[envconfig(from = "MODE", default = "SERVE_API")]
    pub mode: Mode,

    #[envconfig(from = "BACKFILL_REMOTE_SERVER_ADDRESS")]
    pub backfill_remote_server_address: Option<String>,
}

async fn serve_api(
    config: &Config,
) -> Result<(), Box<dyn ::std::error::Error>> {
    info!("Connecting to Postgres");
    let tokio_postgres_config = config
        .postgres_string
        .parse::<::tokio_postgres::config::Config>()?;

    let deadpool_manager_config = ::deadpool_postgres::ManagerConfig {
        recycling_method: ::deadpool_postgres::RecyclingMethod::Fast,
    };

    let deadpool_manager = ::deadpool_postgres::Manager::from_config(
        tokio_postgres_config,
        ::tokio_postgres::NoTls,
        deadpool_manager_config,
    );

    let deadpool_write = ::deadpool_postgres::Pool::builder(deadpool_manager)
        .max_size(16)
        .build()?;

    let pool = ::sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.postgres_string)
        .await?;

    let pool_read_only = ::sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(
            &config
                .postgres_string_read_only
                .clone()
                .unwrap_or(config.postgres_string.clone()),
        )
        .await?;

    let opensearch_transport =
        ::opensearch::http::transport::Transport::single_node(
            &config.opensearch_string,
        )?;

    let opensearch_client = ::opensearch::OpenSearch::new(opensearch_transport);

    info!("Connecting to OpenSearch");

    {
        info!("Creating Schema");
        let mut client = deadpool_write.get().await?;
        let transaction = client.transaction().await?;
        crate::queries::create_schema::execute(&transaction).await?;
        transaction.commit().await?;
    }

    // crate::migrate::migrate(&mut transaction).await?;

    crate::opensearch::prepare_indices(&opensearch_client).await?;

    info!("Connecting to StatsD");

    let socket = UdpSocket::bind("0.0.0.0:0")?;
    socket.set_nonblocking(true)?;
    let host = (config.statsd_address.to_owned(), config.statsd_port);
    let sink = UdpMetricSink::from(host, socket)?;
    let statsd_client = StatsdClient::from_sink("polycentric-server", sink);

    let ingest_cache = ::std::sync::Mutex::new(::lru::LruCache::new(
        core::num::NonZeroUsize::new(1000).context("expected NonZeroUSize")?,
    ));

    let state = ::std::sync::Arc::new(State {
        pool,
        deadpool_write,
        pool_read_only,
        search: opensearch_client,
        admin_token: config.admin_token.clone(),
        challenge_key: config.challenge_key.clone(),
        statsd_client,
        ingest_cache,
    });

    crate::ingest::deadpool_prepare_all(&state.clone()).await?;

    let cors = ::warp::cors()
        .allow_any_origin()
        .max_age(::std::time::Duration::from_secs(60 * 5))
        .allow_headers(vec!["content-type", "x-polycentric-user-agent"])
        .allow_methods(&[
            ::warp::http::Method::POST,
            ::warp::http::Method::GET,
        ]);

    let state_filter = ::warp::any().map(move || state.clone());

    let route_post_events = ::warp::post()
        .and(::warp::path("events"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::header::optional::<String>(
            "x-polycentric-user-agent",
        ))
        .and(::warp::body::bytes())
        .and_then(crate::handlers::post_events::handler)
        .with(cors.clone());

    let route_get_head = ::warp::get()
        .and(::warp::path("head"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_head::Query>())
        .and_then(crate::handlers::get_head::handler)
        .with(cors.clone());

    let route_get_query_latest = ::warp::get()
        .and(::warp::path("query_latest"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_query_latest::Query>())
        .and_then(crate::handlers::get_query_latest::handler)
        .with(cors.clone());

    let route_get_query_index = ::warp::get()
        .and(::warp::path("query_index"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_query_index::Query>())
        .and_then(crate::handlers::get_query_index::handler)
        .with(cors.clone());

    let route_get_query_references = ::warp::get()
        .and(::warp::path("query_references"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_query_references::Query>())
        .and_then(crate::handlers::get_query_references::handler)
        .with(cors.clone());

    let route_get_events = ::warp::get()
        .and(::warp::path("events"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_events::Query>())
        .and_then(crate::handlers::get_events::handler)
        .with(cors.clone());

    let route_get_claim_to_system = ::warp::get()
        .and(::warp::path("resolve_claim"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_claim_to_system::Query>())
        .and_then(crate::handlers::get_claim_to_system::handler)
        .with(cors.clone());

    let route_get_ranges = ::warp::get()
        .and(::warp::path("ranges"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_ranges::Query>())
        .and_then(crate::handlers::get_ranges::handler)
        .with(cors.clone());

    let route_get_search = ::warp::get()
        .and(::warp::path("search"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_search::Query>())
        .and_then(crate::handlers::get_search::handler)
        .with(cors.clone());

    let route_get_top_string_references = ::warp::get()
        .and(::warp::path("top_string_references"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<
            crate::handlers::get_top_string_references::Query,
        >())
        .and_then(crate::handlers::get_top_string_references::handler)
        .with(cors.clone());

    let route_get_explore = ::warp::get()
        .and(::warp::path("explore"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_explore::Query>())
        .and_then(crate::handlers::get_explore::handler)
        .with(cors.clone());

    let route_get_recommended_profiles = ::warp::get()
        .and(::warp::path("recommended_profiles"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and_then(crate::handlers::get_recommend_profiles::handler)
        .with(cors.clone());

    let route_get_version = ::warp::get()
        .and(::warp::path("version"))
        .and(::warp::path::end())
        .then(crate::handlers::get_version::handler)
        .with(cors.clone());

    let route_post_censor = ::warp::post()
        .and(::warp::path("censor"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::header::<String>("authorization"))
        .and(::warp::query::<crate::handlers::post_censor::Query>())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::post_censor::handler)
        .with(cors.clone());

    let route_get_find_claim_and_vouch = ::warp::get()
        .and(::warp::path("find_claim_and_vouch"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<
            crate::handlers::get_find_claim_and_vouch::Query,
        >())
        .and_then(crate::handlers::get_find_claim_and_vouch::handler)
        .with(cors.clone());

    let route_get_challenge = ::warp::get()
        .and(::warp::path("challenge"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and_then(crate::handlers::get_challenge::handler)
        .with(cors.clone());

    let route_post_purge = ::warp::post()
        .and(::warp::path("purge"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::post_purge::handler)
        .with(cors.clone());

    let route_post_claim_handle = ::warp::post()
        .and(::warp::path("claim_handle"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::post_claim_handle::handler)
        .with(cors.clone());

    let route_get_resolve_handle = ::warp::get()
        .and(::warp::path("resolve_handle"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_resolve_handle::Query>())
        .and_then(crate::handlers::get_resolve_handle::handler)
        .with(cors.clone());

    let routes = route_post_events
        .or(route_get_head)
        .or(route_get_query_latest)
        .or(route_get_query_index)
        .or(route_get_query_references)
        .or(route_get_events)
        .or(route_get_claim_to_system)
        .or(route_get_ranges)
        .or(route_get_search)
        .or(route_get_top_string_references)
        .or(route_get_explore)
        .or(route_get_recommended_profiles)
        .or(route_get_version)
        .or(route_post_censor)
        .or(route_get_find_claim_and_vouch)
        .or(route_get_challenge)
        .or(route_post_purge)
        .or(route_post_claim_handle)
        .or(route_get_resolve_handle)
        .recover(handle_rejection);

    info!("API server listening on {}", config.http_port_api);
    ::warp::serve(routes)
        .run(([0, 0, 0, 0], config.http_port_api))
        .await;

    Ok(())
}

async fn tokio_main() -> Result<(), Box<dyn ::std::error::Error>> {
    ::env_logger::init();

    let config = Config::init_from_env().unwrap();

    match config.mode {
        Mode::ServeAPI => {
            info!("mode: ServeAPI");

            serve_api(&config).await?;
        }
        Mode::BackfillSearch => {
            info!("mode: BackfillSearch");

            info!("Connecting to Postgres");
            let pool = ::sqlx::postgres::PgPoolOptions::new()
                .max_connections(10)
                .connect(&config.postgres_string)
                .await?;

            let opensearch_transport =
                ::opensearch::http::transport::Transport::single_node(
                    &config.opensearch_string,
                )?;

            let opensearch_client =
                ::opensearch::OpenSearch::new(opensearch_transport);

            info!("Connecting to OpenSearch");

            crate::migrate::backfill_search(pool, opensearch_client).await?;
        }
        Mode::BackfillRemoteServer => {
            info!("mode: BackfillRemoteServer");

            let address = config
                .backfill_remote_server_address
                .context("BACKFILL_REMOTE_SERVER_ADDRESS required")?;

            info!("Connecting to Postgres");
            let pool = ::sqlx::postgres::PgPoolOptions::new()
                .max_connections(10)
                .connect(&config.postgres_string)
                .await?;

            crate::migrate::backfill_remote_server(pool, address).await?;
        }
    }

    Ok(())
}

fn main() {
    let runtime = ::tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(16 * 1024 * 1024)
        .build()
        .unwrap();

    runtime.block_on(async {
        tokio_main().await.unwrap();
    });
}
