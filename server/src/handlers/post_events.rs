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
    user_agent: &Option<String>,
    signed_events: &::std::vec::Vec<crate::model::signed_event::SignedEvent>,
) -> ::anyhow::Result<()> {
    /*
    let mut transaction = state.pool.begin().await?;

    crate::ingest::ingest_events_postgres_batch(&mut transaction, signed_events)
        .await?;

    transaction.commit().await?;
    */

    let mut signed_events_to_ingest_with_pointers = vec![];

    {
        let mut ingest_cache = state.ingest_cache.lock().unwrap();

        for signed_event in signed_events {
            let pointer =
                crate::model::pointer::from_signed_event(signed_event)?;

            if ingest_cache.get(&pointer).is_some() {
                continue;
            } else {
                signed_events_to_ingest_with_pointers
                    .push((signed_event, pointer));
            }
        }
    }

    if !signed_events_to_ingest_with_pointers.is_empty() {
        let mut transaction = state.pool.begin().await?;

        let mut mutations = vec![];

        for (signed_event, _) in &signed_events_to_ingest_with_pointers {
            // crate::ingest::trace_event(user_agent, signed_event)?;

            let mutated = crate::ingest::ingest_event_postgres(&mut transaction, signed_event)
                .await?;

            if let Some(subject) = mutated {
                mutations.push(subject);
            }
        }

        crate::queries::update_counts::update_lww_element_reference_bytes_batch(
            &mut transaction,
            &mutations,
        ).await?;

        transaction.commit().await?;

        {
            let mut ingest_cache = state.ingest_cache.lock().unwrap();

            for (_, pointer) in signed_events_to_ingest_with_pointers {
                ingest_cache.put(pointer, ());
            }
        }
    }

    Ok(())
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    user_agent: Option<String>,
    bytes: ::bytes::Bytes,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let events = crate::warp_try_err_400!(parse_input(bytes));

    for attempt in 1..4 {
        if attempt != 1 {
            ::log::warn!("retrying batch insertion attempt: {:?}", attempt);
        }

        match &handle_batch(&state, &user_agent, &events).await {
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
