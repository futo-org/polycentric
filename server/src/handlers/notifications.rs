use ::protobuf::Message;

#[derive(::sqlx::FromRow)]
struct NotificationRow {
    notification_id: i64,
    for_author_public_key: ::std::vec::Vec<u8>,
    from_author_public_key: ::std::vec::Vec<u8>,
    from_writer_id: ::std::vec::Vec<u8>,
    from_sequence_number: i64,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    const STATEMENT_WITHOUT_INDEX: &str = "
        SELECT *
        FROM notifications
        WHERE for_author_public_key = $1
        ORDER BY notification_id ASC
        LIMIT 20
    ";

    const STATEMENT_WITH_INDEX: &str = "
        SELECT *
        FROM notifications
        WHERE for_author_public_key = $1
        AND notification_id > $2
        ORDER BY notification_id ASC
        LIMIT 20
    ";

    let request =
        crate::protocol::RequestNotifications::parse_from_tokio_bytes(&bytes)
            .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let notifications: ::std::vec::Vec<NotificationRow>;

    let mut transaction =
        state.pool.begin().await.map_err(|e| {
            crate::RequestError::Anyhow(::anyhow::Error::new(e))
        })?;

    if let Some(after_index) = request.after_index {
        notifications =
            ::sqlx::query_as::<_, NotificationRow>(STATEMENT_WITH_INDEX)
                .bind(&request.public_key)
                .bind(after_index as i64)
                .fetch_all(&mut transaction)
                .await
                .map_err(|e| {
                    crate::RequestError::Anyhow(::anyhow::Error::new(e))
                })?;
    } else {
        notifications =
            ::sqlx::query_as::<_, NotificationRow>(STATEMENT_WITHOUT_INDEX)
                .bind(&request.public_key)
                .fetch_all(&mut transaction)
                .await
                .map_err(|e| {
                    crate::RequestError::Anyhow(::anyhow::Error::new(e))
                })?;
    }

    let mut history: ::std::vec::Vec<crate::postgres::store_item::StoreItem> =
        vec![];

    for notification in &notifications {
        let identity = ::ed25519_dalek::PublicKey::from_bytes(
            &notification.from_author_public_key,
        )
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

        let writer =
            crate::model::vec_to_writer_id(&notification.from_writer_id)
                .map_err(|e| crate::RequestError::Anyhow(e))?;

        let sequence_number = notification.from_sequence_number;

        let store_item = crate::postgres::get_specific_event(
            &mut transaction,
            &crate::model::pointer::Pointer::new(
                identity,
                writer,
                sequence_number.try_into().unwrap(),
            ),
        )
        .await
        .map_err(|e| crate::RequestError::Anyhow(e))?;

        if let Some(event) = store_item {
            history.push(event);
        }
    }

    let mut processed_events =
        crate::process_mutations2(&mut transaction, history)
            .await
            .map_err(|e| crate::RequestError::Anyhow(e))?;

    let mut result = crate::protocol::ResponseNotifications::new();

    for notification in &notifications {
        if let Some(largest_index) = result.largest_index {
            if notification.notification_id > (largest_index as i64) {
                result.largest_index =
                    Some(notification.notification_id as u64);
            }
        } else {
            result.largest_index = Some(notification.notification_id as u64);
        }
    }

    result
        .related_events
        .append(&mut processed_events.related_events);

    result
        .result_events
        .append(&mut processed_events.result_events);

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
