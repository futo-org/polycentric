use crate::{
    model::{known_message_types, pointer},
    protocol::Post,
};
use ::log::*;
use ::opensearch::IndexParts;
use ::protobuf::Message;
use ::std::collections::HashMap;
use ::std::fmt::Error;
use ::std::time::SystemTime;

pub(crate) fn trace_event(
    user_agent: &Option<String>,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<()> {
    let event = crate::model::event::from_vec(signed_event.event())?;

    let mut content_str: String = "unknown".to_string();

    let content_type = *event.content_type();

    if content_type == crate::model::known_message_types::POST {
        content_str = Post::parse_from_bytes(event.content())?
            .content
            .ok_or(Error)?;
    } else if content_type == crate::model::known_message_types::USERNAME
        || content_type == crate::model::known_message_types::DESCRIPTION
        || content_type == crate::model::known_message_types::STORE
    {
        let lww_element = event.lww_element().clone().ok_or(Error)?;

        content_str = String::from_utf8(lww_element.value)?;
    } else if content_type == crate::model::known_message_types::SERVER
        || content_type == crate::model::known_message_types::AUTHORITY
    {
        let lww_element_set = event.lww_element_set().clone().ok_or(Error)?;

        content_str = String::from_utf8(lww_element_set.value)?;
    } else if content_type == crate::model::known_message_types::OPINION {
        let lww_element = event.lww_element().clone().ok_or(Error)?;

        if lww_element.value == vec![1] {
            content_str = "LIKE".to_string();
        } else if lww_element.value == vec![2] {
            content_str = "DISLIKE".to_string();
        } else if lww_element.value == vec![3] {
            content_str = "NEUTRAL".to_string();
        }
    }

    debug!(
        "ingesting {:?} {}:{} event_type: {} details: {}",
        user_agent,
        crate::model::public_key::to_base64(event.system())?,
        *event.logical_clock(),
        crate::model::content_type_to_string(*event.content_type()),
        content_str,
    );

    Ok(())
}

fn filter_subjects_of_deletes(
    batch: &mut HashMap<
        crate::model::InsecurePointer,
        crate::model::EventLayers,
    >,
) {
    let mut to_remove = vec![];

    for (insecure_pointer, layers) in batch.into_iter() {
        if let crate::model::content::Content::Delete(body) = &layers.content()
        {
            to_remove.push(crate::model::InsecurePointer::new(
                layers.event().system().clone(),
                layers.event().process().clone(),
                *layers.event().logical_clock(),
            ));
        }
    }

    for insecure_pointer in to_remove.into_iter() {
        batch.remove(&insecure_pointer);
    }
}

pub(crate) async fn ingest_events_postgres_batch(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: &mut HashMap<
        crate::model::InsecurePointer,
        crate::model::EventLayers,
    >,
) -> ::anyhow::Result<()> {
    filter_subjects_of_deletes(batch);

    let server_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)?
        .as_secs();

    let inserted_events =
        crate::queries::insert_event_batch::insert_event_batch(
            &mut *transaction,
            batch,
            server_time,
        )
        .await?;

    let mut insert_reference_batch_pointer =
        crate::queries::insert_reference_batch::PointerBatch::new();

    let mut insert_reference_batch_bytes =
        crate::queries::insert_reference_batch::BytesBatch::new();

    let mut insert_delete_batch =
        crate::queries::insert_delete_batch::Batch::new();

    let mut insert_claim_batch =
        crate::queries::insert_claim_batch::Batch::new();

    let mut insert_lww_element_batch =
        crate::queries::insert_lww_element_batch::Batch::new();

    for item in inserted_events.values() {
        for reference in item.layers().event().references().iter() {
            match reference {
                crate::model::reference::Reference::Pointer(pointer) => {
                    insert_reference_batch_pointer.append(
                        item.id(),
                        *item.layers().event().content_type(),
                        &pointer,
                    )?;
                }
                crate::model::reference::Reference::Bytes(bytes) => {
                    insert_reference_batch_bytes
                        .append(item.id(), bytes.clone())?;
                }
                _ => {}
            }
        }

        match item.layers().content() {
            crate::model::content::Content::Delete(body) => {
                insert_delete_batch.append(
                    item.id(),
                    item.layers().event().system(),
                    body,
                )?;
            }
            crate::model::content::Content::Claim(body) => {
                insert_claim_batch.append(item.id(), body)?;
            }
            _ => {}
        }

        if let Some(lww_element) = item.layers().event().lww_element() {
            insert_lww_element_batch.append(item.id(), lww_element)?;
        }
    }

    crate::queries::insert_reference_batch::insert_pointer(
        &mut *transaction,
        insert_reference_batch_pointer,
    )
    .await?;

    crate::queries::insert_reference_batch::insert_bytes(
        &mut *transaction,
        insert_reference_batch_bytes,
    )
    .await?;

    crate::queries::insert_delete_batch::insert(
        &mut *transaction,
        insert_delete_batch,
    )
    .await?;

    crate::queries::insert_claim_batch::insert(
        &mut *transaction,
        insert_claim_batch,
    )
    .await?;

    crate::queries::insert_lww_element_batch::insert(
        &mut *transaction,
        insert_lww_element_batch,
    )
    .await?;

    Ok(())
}

pub(crate) async fn ingest_event_postgres(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<Option<crate::queries::update_counts::EventWithRowId>> {
    let event = crate::model::event::from_vec(signed_event.event())?;

    if crate::postgres::does_event_exist(&mut *transaction, &event).await? {
        return Ok(None);
    }

    if crate::postgres::is_event_deleted(&mut *transaction, &event).await? {
        return Ok(None);
    }

    let server_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)?
        .as_secs();

    let content = crate::model::content::decode_content(
        *event.content_type(),
        event.content(),
    )?;

    /*
    crate::queries::update_counts::update_counts(
        &mut *transaction,
        &event,
        &content,
    )
    .await?;
    */

    let event_id = crate::postgres::insert_event(
        &mut *transaction,
        signed_event,
        server_time,
    )
    .await?;

    for reference in event.references().iter() {
        match reference {
            crate::model::reference::Reference::Pointer(pointer) => {
                crate::postgres::insert_event_link(
                    &mut *transaction,
                    event_id,
                    *event.content_type(),
                    pointer,
                )
                .await?;
            }
            crate::model::reference::Reference::Bytes(bytes) => {
                crate::postgres::insert_event_reference_bytes(
                    &mut *transaction,
                    bytes,
                    event_id,
                )
                .await?;
            }
            _ => {}
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

    if let crate::model::content::Content::Delete(body) = &content {
        crate::postgres::delete_event(
            &mut *transaction,
            event_id,
            event.system(),
            body,
        )
        .await?;
    } else if let crate::model::content::Content::Claim(body) = &content {
        crate::postgres::insert_claim(&mut *transaction, event_id, body)
            .await?;
    }

    /*
    if let Some(lww_element) = event.lww_element() {
        crate::postgres::insert_lww_element(
            &mut *transaction,
            event_id,
            lww_element,
        )
        .await?;
    }
    */

    /*
    crate::queries::update_counts::update_lww_element_reference(
        &mut *transaction,
        event_id,
        &event,
    )
    .await?;
    */

    Ok(Some(crate::queries::update_counts::EventWithRowId {
        event_id: event_id,
        event: event,
    }))
}

pub(crate) async fn ingest_event_search(
    search: &::opensearch::OpenSearch,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<()> {
    let event = crate::model::event::from_vec(signed_event.event())?;

    let event_type = *event.content_type();
    if event_type == known_message_types::POST
        || event_type == known_message_types::DESCRIPTION
        || event_type == known_message_types::USERNAME
    {
        let index_name: &str;
        let index_id: String;
        let version: u64;
        let body: crate::OpenSearchContent;

        if event_type == known_message_types::POST {
            index_name = "messages";
            let pointer = pointer::from_signed_event(signed_event)?;
            index_id = pointer::to_base64(&pointer)?;
            version = 0;

            let content_str = Post::parse_from_bytes(event.content())?
                .content
                .ok_or(Error)?;

            let byte_reference =
                event.references().iter().find_map(|reference| {
                    if let crate::model::reference::Reference::Bytes(bytes) =
                        reference
                    {
                        String::from_utf8(bytes.clone()).ok()
                    } else {
                        None
                    }
                });

            let unix_milliseconds = event.unix_milliseconds();

            body = crate::OpenSearchContent {
                message_content: content_str,
                unix_milliseconds: *unix_milliseconds,
                byte_reference,
            };
        } else {
            index_name = if event_type == known_message_types::USERNAME {
                "profile_names"
            } else {
                "profile_descriptions"
            };
            let lww_element = event.lww_element().clone().ok_or_else(|| {
                println!("LWW Element had no content");
                Error
            })?;
            version = lww_element.unix_milliseconds;
            index_id = crate::model::public_key::to_base64(event.system())?;
            let content_str = String::from_utf8(lww_element.value)?;

            body = crate::OpenSearchContent {
                message_content: content_str,
                byte_reference: None,
                unix_milliseconds: None,
            };
        }

        search
            .index(IndexParts::IndexId(index_name, &index_id))
            .version_type(opensearch::params::VersionType::External)
            .version(i64::try_from(version)?)
            .body(body)
            .send()
            .await?;
    }

    Ok(())
}

pub(crate) async fn ingest_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
    state: &::std::sync::Arc<crate::State>,
) -> ::anyhow::Result<()> {
    ingest_event_postgres(transaction, signed_event).await?;
    ingest_event_search(&state.search, signed_event).await?;

    Ok(())
}
