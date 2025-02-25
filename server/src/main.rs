use ::anyhow::Context;
use ::cadence::{StatsdClient, UdpMetricSink};
use ::log::*;
use ::std::net::UdpSocket;
use ::warp::Filter;
use ::warp::Reply;
use config::ModerationMode;
use envconfig::Envconfig;
use polycentric_protocol::model;

mod cache;
mod config;
mod handlers;
mod ingest;
mod migrate;
mod moderation;
mod opensearch;
mod postgres;
mod version;
use config::{Config, Mode};

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
    pool_read_only: ::sqlx::PgPool,
    search: ::opensearch::OpenSearch,
    admin_token: String,
    statsd_client: ::cadence::StatsdClient,
    challenge_key: String,
    ingest_cache: ::std::sync::Mutex<
        ::lru::LruCache<polycentric_protocol::model::InsecurePointer, ()>,
    >,
    moderation_mode: ModerationMode,
    cache_provider: Option<Box<dyn cache::providers::interface::CacheProvider>>,
}

async fn handler_404(path: ::warp::path::FullPath) -> ::warp::reply::Response {
    ::log::warn!("404 {}", path.as_str());

    ::warp::reply::with_status("404", ::warp::http::StatusCode::NOT_FOUND)
        .into_response()
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

async fn serve_api(
    config: &Config,
    pool: &::sqlx::PgPool,
) -> Result<(), Box<dyn ::std::error::Error>> {
    info!("Connecting to Postgres");

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

    let cache_provider = cache::providers::make_provider(config)?;

    let state = ::std::sync::Arc::new(State {
        pool: pool.clone(),
        pool_read_only,
        search: opensearch_client,
        admin_token: config.admin_token.clone(),
        challenge_key: config.challenge_key.clone(),
        statsd_client,
        ingest_cache,
        moderation_mode: config.moderation_mode,
        cache_provider: Some(cache_provider),
    });

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
        .and(::warp::query::<
            crate::handlers::get_recommend_profiles::Query,
        >())
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

    let route_404 = ::warp::any()
        .and(::warp::path::full())
        .then(handler_404)
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
        .or(route_404)
        .recover(handle_rejection);

    info!("API server listening on {}", config.http_port_api);
    ::warp::serve(routes)
        .run(([0, 0, 0, 0], config.http_port_api))
        .await;

    Ok(())
}

async fn run_moderation_queue(
    config: &Config,
    pool: &::sqlx::PgPool,
) -> Result<(), Box<dyn ::std::error::Error>> {
    let csam_provider = if config.csam_interface.is_none() {
        info!("CSAM interface not provided, skipping CSAM queue");
        None
    } else {
        Some(moderation::providers::csam::make_provider(config).await?)
    };
    let tag_provider = if config.tag_interface.is_none() {
        info!(
            "Moderation tagging interface not provided, skipping tagging queue"
        );
        None
    } else {
        Some(moderation::providers::tags::make_provider(config).await?)
    };

    if tag_provider.is_none() {
        error!(
            "No moderation interface provided and moderation mode is not off"
        );
        return Err(
            "No moderation interface provided and moderation mode is not off"
                .into(),
        );
    }

    let pool_clone = pool.clone();
    let tagging_request_rate_limit = config.tagging_request_rate_limit;
    let csam_request_rate_limiter = config.csam_request_rate_limit;
    let task = tokio::task::spawn({
        async move {
            let result = moderation::moderation_queue::run(
                pool_clone,
                csam_provider.as_deref(),
                tag_provider.as_deref(),
                tagging_request_rate_limit,
                csam_request_rate_limiter,
            )
            .await;
            if let Err(e) = result {
                error!("Error running moderation queue: {}", e);
            }
        }
    });
    task.await?;

    Ok(())
}

#[::tokio::main]
async fn main() -> Result<(), Box<dyn ::std::error::Error>> {
    ::env_logger::init();

    let config = Config::init_from_env().unwrap();

    match config.mode {
        Mode::ServeAPI => {
            info!("mode: ServeAPI");

            let pool = ::sqlx::postgres::PgPoolOptions::new()
                .max_connections(10)
                .connect(&config.postgres_string)
                .await?;

            let mut transaction = pool.begin().await?;

            crate::postgres::prepare_database(&mut transaction).await?;

            crate::migrate::migrate(&mut transaction).await?;
            transaction.commit().await?;

            let no_interface = config.csam_interface.is_none()
                && config.tag_interface.is_none();

            if no_interface {
                info!("No moderation interface provided, skipping moderation queue");
            }

            // Exit if either the moderation queue or the API server fails
            match config.moderation_mode {
                ModerationMode::Off => {
                    serve_api(&config, &pool).await?;
                }
                _ => {
                    tokio::select! {
                        moderation_end_result = run_moderation_queue(&config, &pool) => {
                            moderation_end_result?;
                        }
                        api_end_result = serve_api(&config, &pool) => {
                            api_end_result?;
                        }
                    }
                }
            }
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

            crate::migrate::backfill_remote_server(
                pool,
                address,
                config.backfill_remote_server_position,
            )
            .await?;
        }
    }

    Ok(())
}
