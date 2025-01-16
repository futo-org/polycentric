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

    result.events = crate::postgres::select_events_by_ranges::select(
        &mut transaction,
        &query.system,
        &query.ranges,
        &crate::moderation::ModerationOptions {
            filters: query.moderation_filters.clone(),
            mode: state.moderation_mode,
        },
    )
    .await?
    .iter()
    .map(polycentric_protocol::model::signed_event::to_proto)
    .collect();

    transaction.commit().await?;

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result.write_to_bytes()?,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    Ok(crate::warp_try_err_500!(handler_inner(state, query).await))
}
