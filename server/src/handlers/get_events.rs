use ::protobuf::Message;

pub fn serde_url_deserialize_ranges_for_system<'de, D>(
    deserializer: D,
) -> Result<polycentric_protocol::protocol::RangesForSystem, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    let proto = polycentric_protocol::protocol::RangesForSystem::parse_from_tokio_bytes(
        &::bytes::Bytes::from(bytes),
    )
    .map_err(::serde::de::Error::custom)?;

    Ok(proto)
}

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "polycentric_protocol::model::public_key::serde_url_deserialize"
    )]
    system: polycentric_protocol::model::public_key::PublicKey,
    #[serde(deserialize_with = "serde_url_deserialize_ranges_for_system")]
    ranges: polycentric_protocol::protocol::RangesForSystem,
    #[serde(
        default,
        deserialize_with = "crate::handlers::util::deserialize_json_string"
    )]
    moderation_filters:
        ::std::option::Option<crate::moderation::ModerationFilters>,
}

async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    let mut transaction = state.pool_read_only.begin().await?;

    let mut result = polycentric_protocol::protocol::Events::new();

    let events = crate::postgres::select_events_by_ranges::select(
        &mut transaction,
        &query.system,
        &query.ranges,
        &crate::moderation::ModerationOptions {
            filters: query.moderation_filters.clone(),
            mode: state.moderation_mode,
        },
    )
    .await?;

    result.events = events
        .iter()
        .map(polycentric_protocol::model::signed_event::to_proto)
        .collect();

    transaction.commit().await?;

    // We want to invalidate the account meta and the events, in case of a new event
    let tags: Vec<String> = crate::cache::util::signed_events_to_cache_tags(
        &events, false, true, false, true,
    );

    let response = ::warp::reply::with_header(
        ::warp::reply::with_status(
            result.write_to_bytes()?,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, s-maxage=3600, max-age=5",
    );

    if !tags.is_empty() {
        if let Some(cache_provider) = state.cache_provider.as_ref() {
            Ok(Box::new(::warp::reply::with_header(
                response,
                cache_provider.get_header_name(),
                cache_provider.get_header_value(&tags),
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
