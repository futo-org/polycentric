use ::protobuf::Message;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    let mut result = crate::protocol::Events::new();

    let mut transaction =
        state.pool.begin().await.map_err(|e| {
            crate::RequestError::Anyhow(::anyhow::Error::new(e))
        })?;

    let random_identities =
        crate::postgres::load_random_identities(&mut transaction)
            .await
            .map_err(|e| crate::RequestError::Anyhow(e))?;

    for random_identity in &random_identities {
        let potential_profile = crate::postgres::load_latest_profile(
            &mut transaction,
            &random_identity,
        )
        .await
        .map_err(|e| crate::RequestError::Anyhow(e))?;

        if let Some(event) = potential_profile {
            let event = crate::model::signed_event_to_protobuf_event(&event);
            result.events.push(event);
        }
    }

    transaction
        .commit()
        .await
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let result_serialized = result
        .write_to_bytes()
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}
