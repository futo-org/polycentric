use ::protobuf::Message;

fn deserialize_ed25519_dalek<'de, D>(
    deserializer: D,
) -> Result<::ed25519_dalek::PublicKey, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    ::ed25519_dalek::PublicKey::from_bytes(
        &::bytes::Bytes::from(bytes),
    )
    .map_err(::serde::de::Error::custom)
}

fn deserialize_writer_id<'de, D>(
    deserializer: D,
) -> Result<crate::model::WriterId, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    crate::model::vec_to_writer_id(
        &bytes,
    )
    .map_err(::serde::de::Error::custom)
}

#[derive(::serde::Deserialize)]
pub (crate) struct Query {
    cursor: Option<u64>,
    #[serde(deserialize_with = "deserialize_ed25519_dalek")]
    identity: ::ed25519_dalek::PublicKey,
    #[serde(deserialize_with = "deserialize_writer_id")]
    writer_id: crate::model::WriterId,
    sequence_number: u64,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let mut transaction = match state.pool.begin().await {
        Ok(x) => x,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    let history = match 
        crate::postgres::get_events_linking_to(
            &mut transaction,
            &crate::postgres::LinkType::React,
            &crate::model::pointer::Pointer::new(
                query.identity,
                query.writer_id,
                query.sequence_number,
            ),
        ).await
    {
        Ok(a) => a,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    let mut processed_events =
        match crate::process_mutations2(&mut transaction, history).await {
            Ok(a) => a,
            Err(err) => {
                return Ok(Box::new(::warp::reply::with_status(
                    err.to_string().clone(),
                    ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                )));
            }
        };

    match transaction.commit().await {
        Ok(()) => (),
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    let mut result =
        crate::protocol::ResultEventsAndRelatedEventsAndCursor::new();

    result
        .related_events
        .append(&mut processed_events.related_events);

    result
        .result_events
        .append(&mut processed_events.result_events);

    let result_serialized = match result.write_to_bytes() {
        Ok(a) => a,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
