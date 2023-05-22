use ::envconfig::Envconfig;
use ::log::*;
use ::protobuf::Message;
use std::net::UdpSocket;
use ::warp::Filter;
use cadence::{StatsdClient, UdpMetricSink};

mod handlers;
mod ingest;
mod model;
mod postgres;
mod version;
mod queries;

include!(concat!(env!("OUT_DIR"), "/protos/mod.rs"));

#[macro_export]
macro_rules! warp_try_err_500 {
    ($expr:expr) => {
        match $expr {
            Ok(x) => x,
            Err(err) => {
                return Ok(Box::new(::warp::reply::with_status(
                    err.to_string().clone(),
                    ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                )));
            }
        }
    };
}

struct State {
    pool: ::sqlx::PgPool,
    search: ::opensearch::OpenSearch,
    admin_token: String,
    statsd_client: ::cadence::StatsdClient
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
    } else if let Some(_) = err.find::<::warp::reject::MethodNotAllowed>() {
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

#[derive(::serde::Deserialize)]
struct OpenSearchPointer {
    author_public_key: String,
    writer_id: String,
    sequence_number: i64,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchL2 {
    _source: OpenSearchPointer,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchL1 {
    hits: ::std::vec::Vec<OpenSearchSearchL2>,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchL0 {
    hits: OpenSearchSearchL1,
}

#[derive(::envconfig::Envconfig)]
struct Config {
    #[envconfig(from = "HTTP_PORT_API", default = "8081")]
    pub http_port_api: u16,

    #[envconfig(
        from = "POSTGRES_STRING",
        default = "postgres://postgres:testing@postgres"
    )]
    pub postgres_string: String,

    #[envconfig(
        from = "OPENSEARCH_STRING",
        default = "http://opensearch-node1:9200"
    )]
    pub opensearch_string: String,

    #[envconfig(from = "ADMIN_TOKEN")]
    pub admin_token: String,

    #[envconfig(
        from = "STATSD_ADDRESS",
        default = "telegraf"
    )]
    pub statsd_address: String,

    #[envconfig(
        from = "STATSD_ADDRESS",
        default = "8125"
    )]
    pub statsd_port: u16,
}

async fn serve_api(
    config: &Config,
) -> Result<(), Box<dyn ::std::error::Error>> {
    info!("Connecting to Postgres");
    let pool = ::sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.postgres_string)
        .await?;

    let opensearch_transport =
        ::opensearch::http::transport::Transport::single_node(
            &config.opensearch_string,
        )?;

    let opensearch_client = ::opensearch::OpenSearch::new(opensearch_transport);

    info!("Connecting to OpenSearch");
    // opensearch_client.ping().send().await?;

    let mut transaction = pool.begin().await?;

    crate::postgres::prepare_database(&mut transaction).await?;

    transaction.commit().await?;

    info!("Connecting to StatsD");

    let socket = UdpSocket::bind("0.0.0.0:0")?;
    socket.set_nonblocking(true)?;
    let host = (config.statsd_address.to_owned(), config.statsd_port);
    let sink = UdpMetricSink::from(host, socket)?;
    let statsd_client = StatsdClient::from_sink("polycentric-server", sink);

    let state = ::std::sync::Arc::new(State {
        pool,
        search: opensearch_client,
        admin_token: config.admin_token.clone(),
        statsd_client: statsd_client
    });

    let cors = ::warp::cors()
        .allow_any_origin()
        .max_age(::std::time::Duration::from_secs(60 * 5))
        .allow_headers(vec!["content-type"])
        .allow_methods(&[
            ::warp::http::Method::POST,
            ::warp::http::Method::GET,
        ]);

    let state_filter = ::warp::any().map(move || state.clone());

    let route_post_events = ::warp::post()
        .and(::warp::path("events"))
        .and(::warp::path::end())
        .and(state_filter.clone())
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

    let route_get_query_index = ::warp::get()
        .and(::warp::path("query_index"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::query::<crate::handlers::get_query_index::Query>())
        .and_then(crate::handlers::get_query_index::handler)
        .with(cors.clone());

    let route_get_query_references= ::warp::get()
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

    let route_get_explore = ::warp::get()
        .and(::warp::path("explore"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and_then(crate::handlers::get_explore::handler)
        .with(cors.clone());

    let route_get_notifications = ::warp::get()
        .and(::warp::path("notifications"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and_then(crate::handlers::get_notifications::handler)
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

    let routes = route_post_events
        .or(route_get_head)
        .or(route_get_query_index)
        .or(route_get_query_references)
        .or(route_get_events)
        .or(route_get_claim_to_system)
        .or(route_get_ranges)
        .or(route_get_search)
        .or(route_get_explore)
        .or(route_get_notifications)
        .or(route_get_recommended_profiles)
        .or(route_get_version)
        .or(route_post_censor)
        .recover(handle_rejection);

    info!("API server listening on {}", config.http_port_api);
    ::warp::serve(routes)
        .run(([0, 0, 0, 0], config.http_port_api))
        .await;

    Ok(())
}

#[::tokio::main]
async fn main() -> Result<(), Box<dyn ::std::error::Error>> {
    ::env_logger::init();
    
    let config = Config::init_from_env().unwrap();

    serve_api(&config).await?;

    Ok(())
}
