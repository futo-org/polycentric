use crate::model::{known_message_types, pointer};
use ::cadence::Counted;
use ::log::*;
use ::opensearch::IndexParts;
use ::polycentric_protocol::protocol::Post;
use ::protobuf::Message;
use ::std::collections::HashMap;
use ::std::fmt::Error;
use ::std::ops::Deref;
use ::std::time::SystemTime;

// full ingestion pipeline
pub(crate) async fn ingest_event_batch(
    state: &::std::sync::Arc<crate::State>,
    user_agent: &Option<String>,
    signed_events: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
) -> ::anyhow::Result<()> {
    let mut batch = construct_event_batch(signed_events.clone())?;

    filter_subjects_of_deletes(&mut batch);
    filter_recently_ingested(state, &mut batch);

    for layers in batch.values() {
        trace_event(user_agent, layers.event())?;
    }

    for attempt in 1..4 {
        if attempt != 1 {
            ::log::warn!("ingest_event_postgres_batch failed, retrying");
        }

        match ingest_event_postgres_batch_transaction(state, &batch).await {
            Ok(_) => {
                break;
            }
            Err(err) => {
                if attempt == 3 {
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

    for layers in batch.values() {
        ingest_event_search(&state.search, layers).await?;
    }

    mark_as_recently_ingested(state, &batch);

    state
        .statsd_client
        .count_with_tags("ingest_success", i64::try_from(batch.len())?)
        .with_tag(
            "user_agent",
            &user_agent.clone().unwrap_or("unknown".to_string()),
        )
        .try_send()?;

    Ok(())
}

fn trace_event(
    user_agent: &Option<String>,
    event: &crate::model::event::Event,
) -> ::anyhow::Result<()> {
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

    for layers in batch.values() {
        if let crate::model::content::Content::Delete(body) = &layers.content()
        {
            to_remove.push(crate::model::InsecurePointer::new(
                layers.event().system().clone(),
                body.process().clone(),
                *body.logical_clock(),
            ));
        }
    }

    for insecure_pointer in to_remove.into_iter() {
        batch.remove(&insecure_pointer);
    }
}

fn filter_recently_ingested(
    state: &::std::sync::Arc<crate::State>,
    batch: &mut HashMap<
        crate::model::InsecurePointer,
        crate::model::EventLayers,
    >,
) {
    let mut to_remove = vec![];

    {
        let mut ingest_cache = state.ingest_cache.lock().unwrap();

        for pointer in batch.keys() {
            if ingest_cache.get(pointer).is_some() {
                to_remove.push(pointer.clone());
            }
        }
    }

    for insecure_pointer in to_remove.iter() {
        batch.remove(insecure_pointer);
    }
}

fn mark_as_recently_ingested(
    state: &::std::sync::Arc<crate::State>,
    batch: &HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
) {
    let mut ingest_cache = state.ingest_cache.lock().unwrap();

    for pointer in batch.keys() {
        ingest_cache.put(pointer.clone(), ());
    }
}

// convenience function for tests
#[allow(dead_code)]
pub(crate) async fn ingest_event_postgres(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<()> {
    let mut batch = HashMap::new();

    let layers = crate::model::EventLayers::new(signed_event.clone())?;

    batch.insert(
        crate::model::InsecurePointer::new(
            layers.event().system().clone(),
            layers.event().process().clone(),
            *layers.event().logical_clock(),
        ),
        layers,
    );

    ingest_event_postgres_batch(&mut *transaction, &batch).await?;

    Ok(())
}

async fn ingest_event_postgres_batch(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: &HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
) -> ::anyhow::Result<()> {
    crate::postgres::select_system_locks::select(&mut *transaction, batch)
        .await?;

    for layers in batch.values() {
        ingest_event_postgres_single(&mut *transaction, layers).await?;
    }

    Ok(())
}

// singular event portion called only by ingest_event_postgres_batch
async fn ingest_event_postgres_single(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    layers: &crate::model::EventLayers,
) -> ::anyhow::Result<()> {
    let event = layers.event();

    if crate::postgres::does_event_exist(&mut *transaction, event).await? {
        return Ok(());
    }

    if crate::postgres::is_event_deleted(&mut *transaction, event).await? {
        return Ok(());
    }

    let server_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)?
        .as_secs();

    let content = layers.content();

    // update_counts must run before delete_event or event inserted
    crate::postgres::update_counts::update_counts(
        &mut *transaction,
        event,
        content,
    )
    .await?;

    let event_id = crate::postgres::insert_event(
        &mut *transaction,
        layers.signed_event(),
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

    if let Some(lww_element) = event.lww_element() {
        crate::postgres::insert_lww_element(
            &mut *transaction,
            event_id,
            lww_element,
        )
        .await?;
    }

    crate::postgres::update_counts::update_lww_element_reference(
        &mut *transaction,
        event_id,
        event,
    )
    .await?;

    Ok(())
}

pub(crate) async fn ingest_event_search(
    search: &::opensearch::OpenSearch,
    layers: &crate::model::EventLayers,
) -> ::anyhow::Result<()> {
    let signed_event = layers.signed_event();
    let event = layers.event();

    let event_type = *event.content_type();
    if event_type == known_message_types::POST
        || event_type == known_message_types::DESCRIPTION
        || event_type == known_message_types::USERNAME
    {
        let index_name: &str;
        let index_id: String;
        let version: u64;
        let body: crate::opensearch::OpenSearchContent;

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

            body = crate::opensearch::OpenSearchContent {
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

            body = crate::opensearch::OpenSearchContent {
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

async fn ingest_event_postgres_batch_transaction(
    state: &::std::sync::Arc<crate::State>,
    batch: &HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
) -> ::anyhow::Result<()> {
    let mut transaction = state.pool.begin().await?;
    ingest_event_postgres_batch(&mut transaction, batch).await?;
    transaction.commit().await?;
    Ok(())
}

fn construct_event_batch(
    signed_events: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
) -> ::anyhow::Result<
    HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
> {
    let mut batch = HashMap::new();

    for signed_event in signed_events {
        let layers = crate::model::EventLayers::new(signed_event)?;

        batch.insert(
            crate::model::InsecurePointer::new(
                layers.event().system().clone(),
                layers.event().process().clone(),
                *layers.event().logical_clock(),
            ),
            layers,
        );
    }

    Ok(batch)
}
