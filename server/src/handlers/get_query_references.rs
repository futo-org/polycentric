use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
    #[serde(
        deserialize_with = "crate::model::process::serde_url_deserialize"
    )]
    process: crate::model::process::Process,
    logical_clock: u64,
    from_type: u64,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let mut transaction = crate::warp_try_err_500!(state.pool.begin().await);

    let mut result = crate::protocol::Events::new();

    let batch = crate::warp_try_err_500!(
        crate::postgres::find_references(
            &mut transaction,
            &query.system,
            &query.process,
            query.logical_clock,
            query.from_type,
        ).await
    );

    for event in batch.iter() {
        result.events.push(
            crate::model::signed_event::to_proto(event),
        );
    }

    crate::warp_try_err_500!(transaction.commit().await);

    let result_serialized = crate::warp_try_err_500!(
        result.write_to_bytes()
    );

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
