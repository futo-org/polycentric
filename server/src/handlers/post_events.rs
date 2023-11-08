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

async fn handle_batch(
    state: &::std::sync::Arc<crate::State>,
    events: &::std::vec::Vec<crate::model::signed_event::SignedEvent>,
) -> ::anyhow::Result<()> {
    let mut transaction = state.pool.begin().await?;

    for event in events {
        crate::ingest::ingest_event(&mut transaction, event, state).await?;
    }

    transaction.commit().await?;

    Ok(())
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let events = crate::warp_try_err_400!(parse_input(bytes));

    for attempt in 1..4 {
        if attempt != 1 {
            ::log::warn!("retrying batch insertion attempt: {:?}", attempt);
        }

        match &handle_batch(&state, &events).await {
            Ok(_) => break,
            Err(err) => {
                if attempt == 3 {
                    crate::warp_try_err_500!(Err(err));
                }

                match err.downcast_ref::<::sqlx::Error>() {
                    Some(::sqlx::Error::Database(db_err)) => {
                        if db_err.deref().is_unique_violation() {
                            continue;
                        }
                    }
                    _ => {
                        crate::warp_try_err_500!(Err(err));
                    }
                }
            }
        }
    }

    match state.statsd_client.count(
        "events",
        crate::warp_try_err_500!(i64::try_from(events.len())),
    ) {
        Ok(_) => {}
        Err(err) => {
            ::log::warn!("Unable to log event metric due to: {}", err)
        }
    };

    Ok(Box::new(::warp::reply::with_status(
        "",
        ::warp::http::StatusCode::OK,
    )))
}
