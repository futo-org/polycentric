use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "polycentric_protocol::model::public_key::serde_url_deserialize"
    )]
    system: polycentric_protocol::model::public_key::PublicKey,
    #[serde(
        deserialize_with = "polycentric_protocol::model::serde_url_deserialize_repeated_uint64"
    )]
    event_types: polycentric_protocol::protocol::RepeatedUInt64,
}

async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    let mut result = polycentric_protocol::protocol::Events::new();

    let mut transaction = state.pool_read_only.begin().await?;

    let events = crate::postgres::select_latest_by_content_type::select(
        &mut transaction,
        &query.system,
        &query.event_types.numbers,
        &crate::moderation::ModerationOptions {
            filters: None,
            mode: state.moderation_mode,
        },
    )
    .await?;
    transaction.commit().await?;

    let cache_tags: Vec<String> =
        crate::cache::util::signed_events_to_cache_tags(
            &events,
            false,
            false,
            false,
            true,
        );

    result.events = events
        .iter()
        .map(polycentric_protocol::model::signed_event::to_proto)
        .collect();

    let response = ::warp::reply::with_header(
        ::warp::reply::with_status(
            result.write_to_bytes()?,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, s-maxage=3600, max-age=5",
    );

    if !cache_tags.is_empty() {
        if let Some(cache_provider) = state.cache_provider.as_ref() {
            Ok(Box::new(::warp::reply::with_header(
                response,
                cache_provider.get_header_name(),
                cache_provider.get_header_value(&cache_tags),
            )))
        } else {
            Ok(Box::new(response))
        }
    } else {
        Ok(Box::new(response))
    }
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    Ok(crate::warp_try_err_500!(handler_inner(state, query).await))
}
