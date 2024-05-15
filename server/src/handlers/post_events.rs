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

async fn ingest_event_transaction(
    state: &::std::sync::Arc<crate::State>,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<()> {
    let mut transaction = state.pool.begin().await?;
    crate::ingest::ingest_event(&mut transaction, signed_event, state).await?;
    transaction.commit().await?;
    Ok(())
}

async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    user_agent: Option<String>,
    signed_events: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    for signed_event in signed_events {
        let pointer = crate::model::pointer::from_signed_event(&signed_event)?;

        {
            let mut ingest_cache = state.ingest_cache.lock().unwrap();

            if ingest_cache.get(&pointer).is_some() {
                continue;
            }
        }

        crate::ingest::trace_event(&user_agent, &signed_event)?;

        for attempt in 1..4 {
            if attempt != 1 {
                ::log::warn!("event ingest failed, retrying");
            }

            match ingest_event_transaction(&state, &signed_event).await {
                Ok(_) => {
                    state
                        .statsd_client
                        .count_with_tags("ingest_success", 1)
                        .with_tag(
                            "user_agent",
                            &user_agent
                                .clone()
                                .unwrap_or("unknown".to_string()),
                        )
                        .try_send()?;

                    let mut ingest_cache = state.ingest_cache.lock().unwrap();
                    ingest_cache.put(pointer.clone(), ());

                    break;
                }
                Err(err) => {
                    if attempt == 3 {
                        state
                            .statsd_client
                            .count_with_tags("ingest_failed", 1)
                            .with_tag(
                                "user_agent",
                                &user_agent
                                    .clone()
                                    .unwrap_or("unknown".to_string()),
                            )
                            .try_send()?;

                        return Err(err);
                    }

                    match err.downcast_ref::<::sqlx::Error>() {
                        Some(::sqlx::Error::Database(db_err)) => {
                            if db_err.deref().is_unique_violation() {
                                continue;
                            }
                        }
                        _ => {
                            return Err(err);
                        }
                    }
                }
            }
        }
    }

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
