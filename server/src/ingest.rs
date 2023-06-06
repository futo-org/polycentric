use std::fmt::Error;

use crate::{model::{known_message_types, pointer}, protocol::Post};
use ::protobuf::Message;
use opensearch::IndexParts;
use serde_json::json;

pub(crate) async fn ingest_event_postgres(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<()> {
    let event = crate::model::event::from_vec(&signed_event.event())?;

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

    if let crate::model::content::Content::Delete(body) = content {
        crate::postgres::delete_event(
            &mut *transaction,
            event_id,
            event.system(),
            &body,
        )
        .await?;
    } else if let crate::model::content::Content::Claim(body) = content {
        crate::postgres::insert_claim(
            &mut *transaction,
            event_id,
            body.claim_type(),
        )
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

    Ok(())
}


pub(crate) async fn ingest_event_search(
    signed_event: &crate::model::signed_event::SignedEvent,
    state: &::std::sync::Arc<crate::State>,
) -> ::anyhow::Result<()> {

    let event = crate::model::event::from_vec(&signed_event.event())?;


    let event_type = *event.content_type();
    if event_type == known_message_types::POST
        || event_type == known_message_types::DESCRIPTION
        || event_type == known_message_types::USERNAME
    {
        let index_name: &str;
        let index_id: String;
        let content_str: String;
        let version: u64;

        if event_type == known_message_types::POST {
            index_name = "messages";
            let pointer = pointer::from_event(&event)?;
            index_id = pointer::to_base64(&pointer)?;
            version = 0;
            content_str = Post::parse_from_bytes(event.content())?.content.ok_or(Error)?;
        } else {
            index_name = if event_type == known_message_types::USERNAME {
                "profile_names"
            } else {
                "profile_descriptions"
            };
            let lww_element = event.lww_element().clone().ok_or_else(|| { println!("LWW Element had no content"); Error})?;
            version = lww_element.unix_milliseconds;
            index_id = crate::model::public_key::to_base64(event.system())?; 
            content_str = String::from_utf8(lww_element.value)?;
        }

        let body = json!({
            "message_content": content_str,
        });

        state
            .search
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
    ingest_event_search(signed_event, state).await?;
    
    Ok(())
}
