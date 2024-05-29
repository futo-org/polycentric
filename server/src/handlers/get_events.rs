use ::protobuf::Message;

pub fn serde_url_deserialize_ranges_for_system<'de, D>(
    deserializer: D,
) -> Result<crate::protocol::RangesForSystem, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    let proto = crate::protocol::RangesForSystem::parse_from_tokio_bytes(
        &::bytes::Bytes::from(bytes),
    )
    .map_err(::serde::de::Error::custom)?;

    Ok(proto)
}

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
    #[serde(deserialize_with = "serde_url_deserialize_ranges_for_system")]
    ranges: crate::protocol::RangesForSystem,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut client = crate::warp_try_err_500!(state.deadpool_write.get().await);

    let transaction = crate::warp_try_err_500!(client.transaction().await);

    let mut result = crate::protocol::Events::new();

    result.events = crate::warp_try_err_500!(
        crate::queries::select_events_by_ranges::select(
            &transaction,
            &query.system,
            &query.ranges,
        )
        .await
    )
    .iter()
    .map(crate::model::signed_event::to_proto)
    .collect();

    crate::warp_try_err_500!(transaction.commit().await);

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
