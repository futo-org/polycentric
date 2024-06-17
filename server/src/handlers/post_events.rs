use ::cadence::Counted;
use ::protobuf::Message;
use ::std::ops::Deref;

fn parse_input(
    bytes: ::bytes::Bytes,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    crate::protocol::Events::parse_from_tokio_bytes(&bytes)?
        .events
        .iter()
        .map(crate::model::signed_event::from_proto)
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()
}

async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    user_agent: Option<String>,
    signed_events: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    crate::ingest::ingest_event_batch(signed_events, &state).await?;

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
