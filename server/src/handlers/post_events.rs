use ::protobuf::Message;

fn parse_input(
    bytes: ::bytes::Bytes,
) -> ::anyhow::Result<
    ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
> {
    polycentric_protocol::protocol::Events::parse_from_tokio_bytes(&bytes)?
        .events
        .iter()
        .map(polycentric_protocol::model::signed_event::from_proto)
        .collect::<::anyhow::Result<
            ::std::vec::Vec<
                polycentric_protocol::model::signed_event::SignedEvent,
            >,
        >>()
}

async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    user_agent: Option<String>,
    signed_events: ::std::vec::Vec<
        polycentric_protocol::model::signed_event::SignedEvent,
    >,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    crate::ingest::ingest_event_batch(&state, &user_agent, signed_events)
        .await?;

    Ok(Box::new(::warp::reply::with_status(
        "",
        ::warp::http::StatusCode::OK,
    )))
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    user_agent: Option<String>,
    bytes: ::bytes::Bytes,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let events = crate::warp_try_err_400!(parse_input(bytes));

    Ok(crate::warp_try_err_500!(
        handler_inner(state, user_agent, events,).await
    ))
}
