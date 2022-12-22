use ::protobuf::Message;
use ::serde_json::json;
use ::log::*;

async fn persist_event_search(
    state: ::std::sync::Arc<crate::State>,
    event: &crate::protocol::Event,
    event_body: &crate::protocol::EventBody,
) -> Result<(), ::warp::Rejection> {
    if event_body.has_message() {
        let author_public_key = ::base64::encode(&event.author_public_key);
        let writer_id = ::base64::encode(&event.writer_id);
        let sequence_number = event.sequence_number.to_string();

        let key =
            format!("{}{}{}", author_public_key, writer_id, sequence_number,);

        let mut body = crate::OpenSearchSearchDocumentMessage {
            author_public_key: author_public_key,
            writer_id: writer_id,
            sequence_number: event.sequence_number as i64,
            message: None,
        };

        body.message = Some(
            ::std::str::from_utf8(&event_body.message().message)
                .map_err(|e| {
                    crate::RequestError::Anyhow(::anyhow::Error::new(e))
                })?
                .to_string(),
        );

        let response = state
            .search
            .index(::opensearch::IndexParts::IndexId("posts", &key))
            .body(body)
            .send()
            .await
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;

        let err = response.exception()
            .await
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;

        if let Some(body) = err {
            warn!("body {:?}", body);
        }
    }

    if event_body.has_profile() {
        let key = ::base64::encode(&event.author_public_key);
        let writer_id = ::base64::encode(&event.writer_id);

        let mut body = crate::OpenSearchSearchDocumentProfile {
            author_public_key: key.clone(),
            writer_id: writer_id,
            sequence_number: event.sequence_number as i64,
            profile_name: "".to_string(),
            profile_description: None,
            unix_milliseconds: event.unix_milliseconds,
        };

        body.profile_name =
            ::std::str::from_utf8(&event_body.profile().profile_name)
                .map_err(|e| {
                    crate::RequestError::Anyhow(::anyhow::Error::new(e))
                })?
                .to_string();

        if let Some(description) = &event_body.profile().profile_description {
            body.profile_description = Some(
                ::std::str::from_utf8(description)
                .map_err(|e| {
                    crate::RequestError::Anyhow(::anyhow::Error::new(e))
                })?
                .to_string()
            );
        }

        let script = r#"
            if (ctx.op == "create") {
                ctx._source = params
            } else if (ctx._source.unix_milliseconds > params.unix_milliseconds) {
                ctx.op = 'noop'
            } else {
                ctx._source = params
            }
        "#;

        let response = state
            .search
            .update(::opensearch::UpdateParts::IndexId("profiles", &key))
            .body(json!({
                "scripted_upsert": true,
                "script": {
                    "lang": "painless",
                    "params": body,
                    "inline": script,
                },
                "upsert": {}
            }))
            .send()
            .await
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;

        let err = response.exception()
            .await
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;

        if let Some(body) = err {
            warn!("body {:?}", body);
        }
    }

    Ok(())
}

#[derive(::sqlx::FromRow)]
struct NotificationIdRow {
    notification_id: i64,
}

async fn persist_event_notification(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &crate::protocol::Event,
    event_body: &crate::protocol::EventBody,
) -> Result<(), ::warp::Rejection> {
    const LATEST_NOTIFICATION_ID_QUERY_STATEMENT: &str = "
        SELECT notification_id FROM notifications
        WHERE for_author_public_key = $1
        ORDER BY notification_id DESC
        LIMIT 1;
    ";

    const INSERT_NOTIFICATION_STATEMENT: &str = "
        INSERT INTO notifications
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING;
    ";

    if event_body.has_message() == false {
        return Ok(());
    }

    if let ::protobuf::MessageField(Some(pointer)) =
        &event_body.message().boost_pointer
    {
        let potential_row = ::sqlx::query_as::<_, NotificationIdRow>(
            LATEST_NOTIFICATION_ID_QUERY_STATEMENT,
        )
        .bind(&pointer.public_key)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| {
            crate::RequestError::Anyhow(::anyhow::Error::new(e))
        })?;

        let next_id = match potential_row {
            Some(row) => row.notification_id + 1,
            None => 0,
        };

        if pointer.public_key != event.author_public_key {
            ::sqlx::query(INSERT_NOTIFICATION_STATEMENT)
                .bind(next_id)
                .bind(pointer.public_key.clone())
                .bind(event.author_public_key.clone())
                .bind(event.writer_id.clone())
                .bind(event.sequence_number as i64)
                .execute(&mut *transaction)
                .await
                .map_err(|e| {
                    crate::RequestError::Anyhow(::anyhow::Error::new(e))
                })?;
        }
    }

    Ok(())
}

pub (crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    let events = crate::protocol::Events::parse_from_tokio_bytes(&bytes)
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    for event in &events.events {
        if !crate::crypto::validate_signature(event) {
            warn!("failed to validate signature");
            continue;
        }

        let event_body =
            crate::protocol::EventBody::parse_from_bytes(&event.content)
                .map_err(|e| 
                    crate::RequestError::Anyhow(::anyhow::Error::new(e))
                )?;

        let validated_event =
            crate::model::protobuf_event_to_signed_event(event)
                .map_err(|e| crate::RequestError::Anyhow(e))?;

        crate::postgres::persist_event_feed(&mut transaction, &validated_event)
            .await
            .map_err(|e| crate::RequestError::Anyhow(e))?;

        persist_event_notification(&mut transaction, &event, &event_body)
            .await?;

        persist_event_search(state.clone(), &event, &event_body).await?;
    }

    transaction
        .commit()
        .await
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    Ok(::warp::reply::with_status("", ::warp::http::StatusCode::OK))
}


