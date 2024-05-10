use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    Ok(crate::warp_try_err_500!(handler_inner(state, query).await))
}

async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    let mut transaction = state.pool_read_only.begin().await?;

    let head_signed_events =
        crate::postgres::load_system_head(&mut transaction, &query.system)
            .await?;

    let mut result_signed_events = head_signed_events.clone();

    for head_signed_event in head_signed_events.into_iter() {
        let head_event =
            crate::model::event::from_vec(head_signed_event.event())?;

        if *head_event.content_type()
            == crate::model::known_message_types::SYSTEM_PROCESSES
        {
            continue;
        }

        let previous_system_processes_index = head_event
            .indices()
            .indices
            .clone()
            .into_iter()
            .find(|index| {
                index.index_type
                    == crate::model::known_message_types::SYSTEM_PROCESSES
            });

        if let Some(index) = previous_system_processes_index {
            let previous_system_processes_signed_event =
                crate::postgres::load_event(
                    &mut transaction,
                    head_event.system(),
                    head_event.process(),
                    index.logical_clock,
                )
                .await?;

            if let Some(event) = previous_system_processes_signed_event {
                result_signed_events.push(event);
            }
        }
    }

    transaction.commit().await?;

    let mut result = crate::protocol::Events::new();

    result.events = result_signed_events
        .iter()
        .map(crate::model::signed_event::to_proto)
        .collect();

    let result_serialized = result.write_to_bytes()?;

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
