use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
    #[serde(
        deserialize_with = "crate::model::serde_url_deserialize_repeated_uint64"
    )]
    event_types: crate::protocol::RepeatedUInt64,
    limit: ::core::option::Option<u64>,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut transaction = crate::warp_try_err_500!(state.pool.begin().await);

    let processes = crate::warp_try_err_500!(
        crate::postgres::load_processes_for_system(
            &mut transaction,
            &query.system,
        )
        .await
    );

    let mut result = crate::protocol::Events::new();

    for process in processes.iter() {
        for event_type in query.event_types.numbers.iter() {
            let batch = crate::warp_try_err_500!(
                crate::postgres::load_latest_event_by_type(
                    &mut transaction,
                    &query.system,
                    process,
                    *event_type,
                    query.limit.unwrap_or(1),
                )
                .await
            );

            for event in batch.iter() {
                result
                    .events
                    .push(crate::model::signed_event::to_proto(event));
            }
        }
    }

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
