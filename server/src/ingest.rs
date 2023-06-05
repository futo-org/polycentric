use crate::model::{known_message_types, pointer};
use ::protobuf::Message;
use base64::encode;
use opensearch::IndexParts;
use serde_json::json;

pub(crate) async fn ingest_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
    state: &::std::sync::Arc<crate::State>,
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

    // Put messages, descriptions, and usernames into elastic/opensearch
    let event_type = *event.content_type();
    if event_type == known_message_types::POST
        || event_type == known_message_types::DESCRIPTION
        || event_type == known_message_types::USERNAME
    {
        let key_b64 =
            encode(crate::model::public_key::get_key_bytes(event.system()));
        let process_b64 = encode(event.process().bytes());
        let index_name: &str;
        let index_id: String;
        let content_str: String;

        if event_type == known_message_types::POST {
            index_name = "messages";
            let pointer = pointer::from_event(&event).unwrap();

            index_id = pointer::to_base64(&pointer);
            content_str = String::from_utf8(event.content().to_vec())?;
        } else {
            index_name = if event_type == known_message_types::USERNAME {
                "profile_names"
            } else {
                "profile_descriptions"
            };

            index_id = key_b64.clone();
            content_str =
                String::from_utf8(event.lww_element().clone().unwrap().value)?;
        }

        let body = json!({
            "key_type": i64::try_from(crate::model::public_key::get_key_type(
                                        event.system(),
                                    ))?,
            "key_bytes": key_b64,
            "process": process_b64,
            "clock": *event.logical_clock(),
            "message_content": content_str,
        });

        state
            .search
            .index(IndexParts::IndexId(index_name, &index_id))
            .version_type(opensearch::params::VersionType::External)
            .version(*event.logical_clock() as i64)
            .body(body)
            .send()
            .await
            .unwrap();
    }

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
