use ::protobuf::Message;

pub(crate) async fn ingest_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<()> {
    let event = crate::model::event::from_proto(
        &crate::protocol::Event::parse_from_bytes(&signed_event.event())?,
    )?;

    if crate::postgres::does_event_exist(&mut *transaction, &event).await? {
        return Ok(());
    }

    if crate::postgres::is_event_deleted(&mut *transaction, &event).await? {
        return Ok(());
    }

    let event_id =
        crate::postgres::insert_event(&mut *transaction, signed_event).await?;

    let content = crate::model::content::decode_content(
        *event.content_type(),
        event.content(),
    )?;

    for reference in event.references().iter() {
        match reference {
            crate::model::reference::Reference::Pointer(pointer) => {
                crate::postgres::insert_event_link(
                    &mut *transaction,
                    event_id,
                    *event.content_type(),
                    &pointer,
                )
                .await?;
            },
            crate::model::reference::Reference::Bytes(bytes) => {
                crate::postgres::insert_event_reference_bytes(
                    &mut *transaction,
                    bytes,
                    event_id,
                )
                .await?;
            },
            _ => {},
        }
    }

    for index in event.indices().indices.iter() {
        crate::postgres::insert_event_index(
            &mut *transaction,
            event_id,
            index.index_type,
            index.logical_clock,
        )
        .await?;
    }

    if let crate::model::content::Content::Delete(body) = content {
        crate::postgres::delete_event(
            &mut *transaction,
            event_id,
            event.system(),
            &body
        ).await?;
    } else if let crate::model::content::Content::Claim(body) = content {
        crate::postgres::insert_claim(
            &mut *transaction,
            event_id,
            body.claim_type()
        ).await?;
    }

    if let Some(lww_element) = event.lww_element() {
        crate::postgres::insert_lww_element(
            &mut *transaction,
            event_id,
            lww_element,
        ).await?;
    }

    Ok(())
}
