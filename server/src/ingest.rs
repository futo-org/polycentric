use ::protobuf::Message;

pub(crate) async fn ingest_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<()> {
    let event = crate::model::event::from_proto(
        &crate::protocol::Event::parse_from_bytes(&signed_event.event())?,
    )?;

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
        if let crate::model::reference::Reference::Pointer(pointer) = reference
        {
            crate::postgres::insert_event_link(
                &mut *transaction,
                event_id,
                *event.content_type(),
                &pointer,
            )
            .await?;
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
        crate::postgres::delete_event(&mut *transaction, event.system(), &body)
            .await?;
    } else if let crate::model::content::Content::Claim(body) = content {
        crate::postgres::insert_claim(&mut *transaction, body.claim_type())
            .await?;
    }

    Ok(())
}
