use ::protobuf::Message;

enum Operation {
    Increment,
    Decrement,
}

async fn upsert_count_references_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    subject: &::std::vec::Vec<u8>,
    content_type: u64,
    operation: Operation,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO count_references_bytes (
            subject_bytes,
            from_type,
            count
        )
        VALUES (
            $1,
            $2,
            1
        )
        ON CONFLICT (
            subject_bytes,
            from_type
        )
        DO UPDATE
        SET
            count = count_references_bytes.count + $3
    ";

    ::sqlx::query(query)
        .bind(subject)
        .bind(i64::try_from(content_type)?)
        .bind(match operation {
            Operation::Increment => 1,
            Operation::Decrement => -1,
        })
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

async fn upsert_count_lww_element_references_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    subject: &::std::vec::Vec<u8>,
    value: &::std::vec::Vec<u8>,
    content_type: u64,
    operation: Operation,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO count_lww_element_references_bytes (
            subject_bytes,
            from_type,
            value,
            count
        )
        VALUES (
            $1,
            $2,
            $3,
            1
        )
        ON CONFLICT (
            subject_bytes,
            value,
            from_type
        )
        DO UPDATE
        SET
            count = count_lww_element_references_bytes.count + $4
    ";

    ::sqlx::query(query)
        .bind(subject)
        .bind(i64::try_from(content_type)?)
        .bind(value)
        .bind(match operation {
            Operation::Increment => 1,
            Operation::Decrement => -1,
        })
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

async fn upsert_count_references_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    pointer: &crate::model::pointer::Pointer,
    content_type: u64,
    operation: Operation,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO count_references_pointer (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            from_type,
            count
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            1
        )
        ON CONFLICT (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            from_type
        )
        DO UPDATE
        SET
            count = count_references_pointer.count + $6
    ";

    ::sqlx::query(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            pointer.system(),
        ))?)
        .bind(crate::model::public_key::get_key_bytes(pointer.system()))
        .bind(pointer.process().bytes())
        .bind(i64::try_from(*pointer.logical_clock())?)
        .bind(i64::try_from(content_type)?)
        .bind(match operation {
            Operation::Increment => 1,
            Operation::Decrement => -1,
        })
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

async fn upsert_count_lww_element_references_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    pointer: &crate::model::pointer::Pointer,
    value: &::std::vec::Vec<u8>,
    content_type: u64,
    operation: Operation,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO count_lww_element_references_pointer (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            from_type,
            value,
            count
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            1
        )
        ON CONFLICT (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            value,
            from_type
        )
        DO UPDATE
        SET
            count = count_lww_element_references_pointer.count + $7
    ";

    ::sqlx::query(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            pointer.system(),
        ))?)
        .bind(crate::model::public_key::get_key_bytes(pointer.system()))
        .bind(pointer.process().bytes())
        .bind(i64::try_from(*pointer.logical_clock())?)
        .bind(i64::try_from(content_type)?)
        .bind(value)
        .bind(match operation {
            Operation::Increment => 1,
            Operation::Decrement => -1,
        })
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

async fn load_previous_with_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    content_type: u64,
    subject: &::std::vec::Vec<u8>,
) -> ::anyhow::Result<Option<crate::model::signed_event::SignedEvent>> {
    let query = "
        SELECT
            events.raw_event
        FROM
            events 
        INNER JOIN
            lww_elements 
        ON
            events.id = lww_elements.event_id
        INNER JOIN
            event_references_bytes
        ON
            events.id = event_references_bytes.event_id
        WHERE
            events.system_key_type = $1
        AND
            events.system_key = $2
        AND
            events.content_type = $3
        AND
            event_references_bytes.subject_bytes = $4
        ORDER BY
            lww_elements.unix_milliseconds DESC,
            events.process DESC
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(i64::try_from(content_type)?)
        .bind(subject)
        .fetch_optional(&mut *transaction)
        .await?;

    match potential_raw {
        Some(raw) => Ok(Some(crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
        )?)),
        None => Ok(None),
    }
}

async fn load_previous_with_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    content_type: u64,
    subject: &crate::model::pointer::Pointer,
) -> ::anyhow::Result<Option<crate::model::signed_event::SignedEvent>> {
    let query = "
        SELECT
            events.raw_event
        FROM
            events 
        INNER JOIN
            lww_elements 
        ON
            events.id = lww_elements.event_id
        INNER JOIN
            event_links
        ON
            events.id = event_links.event_id
        WHERE
            events.system_key_type = $1
        AND
            events.system_key = $2
        AND
            events.content_type = $3
        AND
            event_links.subject_system_key_type = $4
        AND
            event_links.subject_system_key = $5
        AND
            event_links.subject_process = $6
        AND
            event_links.subject_logical_clock = $7
        ORDER BY
            lww_elements.unix_milliseconds DESC,
            events.process DESC
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(i64::try_from(content_type)?)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            subject.system(),
        ))?)
        .bind(crate::model::public_key::get_key_bytes(subject.system()))
        .bind(subject.process().bytes())
        .bind(i64::try_from(*subject.logical_clock())?)
        .fetch_optional(&mut *transaction)
        .await?;

    match potential_raw {
        Some(raw) => Ok(Some(crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
        )?)),
        None => Ok(None),
    }
}

async fn load_previous(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    reference: &crate::model::reference::Reference,
    content_type: u64,
) -> ::anyhow::Result<Option<crate::model::signed_event::SignedEvent>> {
    Ok(match reference {
        crate::model::reference::Reference::Pointer(pointer) => {
            load_previous_with_pointer(
                &mut *transaction,
                system,
                content_type,
                pointer,
            )
            .await?
        }
        crate::model::reference::Reference::Bytes(bytes) => {
            load_previous_with_bytes(
                &mut *transaction,
                system,
                content_type,
                bytes,
            )
            .await?
        }
        _ => {
            unimplemented!("unhandled reference type");
        }
    })
}

async fn upsert_count_references(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    reference: &crate::model::reference::Reference,
    content_type: u64,
    operation: Operation,
) -> ::anyhow::Result<()> {
    match reference {
        crate::model::reference::Reference::Pointer(pointer) => {
            upsert_count_references_pointer(
                &mut *transaction,
                pointer,
                content_type,
                operation,
            )
            .await?;
        }
        crate::model::reference::Reference::Bytes(bytes) => {
            upsert_count_references_bytes(
                &mut *transaction,
                bytes,
                content_type,
                operation,
            )
            .await?;
        }
        _ => {}
    };
    Ok(())
}

async fn upsert_count_lww_element_references(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    reference: &crate::model::reference::Reference,
    value: &::std::vec::Vec<u8>,
    content_type: u64,
    operation: Operation,
) -> ::anyhow::Result<()> {
    match reference {
        crate::model::reference::Reference::Pointer(pointer) => {
            upsert_count_lww_element_references_pointer(
                &mut *transaction,
                pointer,
                value,
                content_type,
                operation,
            )
            .await?;
        }
        crate::model::reference::Reference::Bytes(bytes) => {
            upsert_count_lww_element_references_bytes(
                &mut *transaction,
                bytes,
                value,
                content_type,
                operation,
            )
            .await?;
        }
        _ => {}
    };
    Ok(())
}

pub(crate) async fn update_counts(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &crate::model::event::Event,
    content: &crate::model::content::Content,
) -> ::anyhow::Result<()> {
    for reference in event.references().iter() {
        upsert_count_references(
            &mut *transaction,
            reference,
            *event.content_type(),
            Operation::Increment,
        )
        .await?;
    }

    if let crate::model::content::Content::Delete(body) = &content {
        let potential_existing = crate::postgres::load_event(
            &mut *transaction,
            event.system(),
            body.process(),
            *body.logical_clock(),
        )
        .await?;

        if let Some(existing_signed_event) = potential_existing {
            let existing_event =
                crate::model::event::from_vec(existing_signed_event.event())?;

            for reference in existing_event.references().iter() {
                upsert_count_references(
                    &mut *transaction,
                    reference,
                    *existing_event.content_type(),
                    Operation::Decrement,
                )
                .await?;
            }
        }
    }

    if let Some(lww_element) = event.lww_element() {
        let potential_previous =
            if let Some(reference) = event.references().first() {
                load_previous(
                    &mut *transaction,
                    event.system(),
                    reference,
                    *event.content_type(),
                )
                .await?
            } else {
                None
            };

        if let Some(previous_signed_event) = potential_previous {
            let previous_event =
                crate::model::event::from_vec(previous_signed_event.event())?;

            if let Some(previous_lww_element) = previous_event.lww_element() {
                if lww_element.unix_milliseconds
                    > previous_lww_element.unix_milliseconds
                {
                    for reference in previous_event.references().iter() {
                        upsert_count_lww_element_references(
                            &mut *transaction,
                            reference,
                            &previous_lww_element.value,
                            *event.content_type(),
                            Operation::Decrement,
                        )
                        .await?;
                    }
                }
            } else {
                return Ok(());
            }
        }

        for reference in event.references().iter() {
            upsert_count_lww_element_references(
                &mut *transaction,
                reference,
                &lww_element.value,
                *event.content_type(),
                Operation::Increment,
            )
            .await?;
        }
    }

    Ok(())
}
