use ::envconfig::Envconfig;
use ::log::*;
use ::protobuf::Message;
use ::warp::Filter;

mod crypto;
mod handlers;
mod model;
mod postgres;
mod protocol;
mod version;

#[derive(Debug)]
enum RequestError {
    Anyhow(::anyhow::Error),
}

#[derive(::serde::Serialize, ::serde::Deserialize)]
struct ClockEntry {
    writer_id: ::std::vec::Vec<u8>,
    sequence_number: u64,
}

impl ::warp::reject::Reject for RequestError {}

struct State {
    pool: ::sqlx::PgPool,
    search: ::opensearch::OpenSearch,
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
    } else if let Some(err) = err.find::<RequestError>() {
        info!("rejection B: {:?}", err);
    }

    Ok(::warp::reply::with_status(
        "INTERNAL_SERVER_ERROR",
        ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
    ))
}

#[derive(::sqlx::Type)]
#[sqlx(type_name = "pointer")]
struct Pointer {
    public_key: ::std::vec::Vec<u8>,
    writer_id: ::std::vec::Vec<u8>,
    sequence_number: i64,
}

#[derive(::sqlx::FromRow)]
pub struct EventRow {
    writer_id: ::std::vec::Vec<u8>,
    author_public_key: ::std::vec::Vec<u8>,
    sequence_number: i64,
    unix_milliseconds: i64,
    content: ::std::vec::Vec<u8>,
    signature: ::std::vec::Vec<u8>,
    clocks: String,
    mutation_pointer: Option<Pointer>,
}

async fn maybe_add_profile2(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    result: &mut ::std::vec::Vec<crate::protocol::Event>,
    profile_keys: &mut ::std::collections::HashSet<::std::vec::Vec<u8>>,
    public_key: &::std::vec::Vec<u8>,
) -> ::anyhow::Result<()> {
    if !profile_keys.contains(public_key) {
        let identity = ::ed25519_dalek::PublicKey::from_bytes(public_key)?;

        let potential_profile =
            crate::postgres::load_latest_profile(&mut *transaction, &identity)
                .await?;

        if let Some(event) = potential_profile {
            let event = crate::model::signed_event_to_protobuf_event(&event);
            result.push(event);
        }

        profile_keys.insert(public_key.clone());
    }

    Ok(())
}

struct ProcessMutationsResult2 {
    related_events: ::std::vec::Vec<crate::protocol::Event>,
    result_events: ::std::vec::Vec<crate::protocol::Event>,
}

async fn process_mutation(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    result: &mut ProcessMutationsResult2,
    profile_keys: &mut ::std::collections::HashSet<::std::vec::Vec<u8>>,
    item: &crate::postgres::store_item::StoreItem,
) -> ::anyhow::Result<()> {
    let mut item_ref = item;

    let mut sub_item_holder: Option<crate::postgres::store_item::StoreItem> =
        None;

    loop {
        maybe_add_profile2(
            &mut *transaction,
            &mut result.related_events,
            &mut *profile_keys,
            &item_ref.pointer().identity().to_bytes().to_vec(),
        )
        .await?;

        match item_ref.value() {
            crate::postgres::store_item::
                MutationPointerOrSignedEvent::MutationPointer(pointer) =>
            {
                let mutation = crate::postgres::get_specific_event(
                    &mut *transaction,
                    &pointer,
                )
                .await?;

                if let Some(sub_item) = mutation {
                    sub_item_holder = Some(sub_item);
                    item_ref = sub_item_holder.as_ref().unwrap();

                    continue;
                }

                break;
            },
            crate::postgres::store_item::
                MutationPointerOrSignedEvent::SignedEvent(event) =>
            {
                let protobuf_event =
                    crate::model::signed_event_to_protobuf_event(&event);

                let event_body =
                    crate::protocol::EventBody::parse_from_bytes(
                            event.event().content()
                        )?;

                if event_body.has_follow() {
                    maybe_add_profile2(
                        &mut *transaction,
                        &mut result.related_events,
                        &mut *profile_keys,
                        &event_body.follow().public_key,
                    )
                    .await?;
                } else if event_body.has_message() {
                    if let Some(pointer) =
                        event_body.message().boost_pointer.as_ref()
                    {
                        maybe_add_profile2(
                            &mut *transaction,
                            &mut result.related_events,
                            &mut *profile_keys,
                            &pointer.public_key,
                        )
                        .await?;
                    }
                }

                result.result_events.push(protobuf_event);

                break;
            }
        }
    }

    Ok(())
}

async fn process_mutations2(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    history: ::std::vec::Vec<crate::postgres::store_item::StoreItem>,
) -> ::anyhow::Result<ProcessMutationsResult2> {
    let mut result = ProcessMutationsResult2 {
        related_events: vec![],
        result_events: vec![],
    };

    let mut profile_keys =
        ::std::collections::HashSet::<::std::vec::Vec<u8>>::new();

    for item in history {
        process_mutation(
            &mut *transaction,
            &mut result,
            &mut profile_keys,
            &item,
        )
        .await?;
    }

    Ok(result)
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

    #[envconfig(from = "HTTP_PORT_STATIC")]
    pub http_port_static: Option<u16>,

    #[envconfig(from = "STATIC_PATH", default = "/static")]
    pub static_path: String,

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

    let state = ::std::sync::Arc::new(State {
        pool,
        search: opensearch_client,
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

    let post_events_route = ::warp::post()
        .and(::warp::path("post_events"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::post_events::handler)
        .with(cors.clone());

    let known_ranges_for_feed_route = ::warp::get()
        .and(::warp::path("known_ranges_for_feed"))
        .and(::warp::path::end())
        .and(::warp::query::<
            crate::handlers::known_ranges_for_feed
                ::RequestKnownRangesForFeedQuery
        >())
        .and(state_filter.clone())
        .and_then(crate::handlers::known_ranges_for_feed::handler)
        .with(cors.clone());

    let known_ranges_route = ::warp::post()
        .and(::warp::path("known_ranges"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::known_ranges::handler)
        .with(cors.clone());

    let request_event_ranges_route = ::warp::get()
        .and(::warp::path("request_event_ranges"))
        .and(::warp::path::end())
        .and(::warp::query::<
            crate::handlers::request_event_ranges::RequestEventRangesQuery,
        >())
        .and(state_filter.clone())
        .and_then(crate::handlers::request_event_ranges::handler)
        .with(cors.clone());

    let request_events_head_route = ::warp::post()
        .and(::warp::path("head"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::head::handler)
        .with(cors.clone());

    let request_search_route = ::warp::post()
        .and(::warp::path("search"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::search::handler)
        .with(cors.clone());

    let request_explore_route = ::warp::post()
        .and(::warp::path("explore"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::explore::handler)
        .with(cors.clone());

    let request_notifications_route = ::warp::post()
        .and(::warp::path("notifications"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(crate::handlers::notifications::handler)
        .with(cors.clone());

    let request_recommend_profiles_route = ::warp::get()
        .and(::warp::path("recommended_profiles"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and_then(crate::handlers::recommend_profiles::handler)
        .with(cors.clone());

    let request_version_route = ::warp::get()
        .and(::warp::path("version"))
        .and(::warp::path::end())
        .and_then(crate::handlers::version::handler)
        .with(cors.clone());

    let routes = post_events_route
        .or(known_ranges_for_feed_route)
        .or(request_event_ranges_route)
        .or(request_events_head_route)
        .or(known_ranges_route)
        .or(request_search_route)
        .or(request_explore_route)
        .or(request_notifications_route)
        .or(request_recommend_profiles_route)
        .or(request_version_route)
        .recover(handle_rejection);

    info!("API server listening on {}", config.http_port_api);
    ::warp::serve(routes)
        .run(([0, 0, 0, 0], config.http_port_api))
        .await;

    Ok(())
}

async fn serve_static(
    config: &Config,
) -> Result<(), Box<dyn ::std::error::Error>> {
    let port = match config.http_port_static {
        Some(x) => x,
        None => return Ok(()),
    };

    let routes = ::warp::filters::fs::dir(config.static_path.clone())
        .or(::warp::filters::fs::file("/static/index.html"))
        .map(|reply| {
            ::warp::reply::with_header(
                reply,
                "Cache-Control",
                "public, no-cache",
            )
        });

    info!("Static server listening on {}", port);
    ::warp::serve(routes).run(([0, 0, 0, 0], port)).await;

    Ok(())
}

#[::tokio::main]
async fn main() -> Result<(), Box<dyn ::std::error::Error>> {
    ::env_logger::init();

    let config = Config::init_from_env().unwrap();

    let server_api = serve_api(&config);
    let server_static = serve_static(&config);

    let (r1, r2) = ::futures::future::join(server_api, server_static).await;
    r1?;
    r2?;

    Ok(())
}
