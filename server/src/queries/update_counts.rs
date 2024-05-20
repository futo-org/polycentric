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
        .execute(&mut **transaction)
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
        .execute(&mut **transaction)
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
        .execute(&mut **transaction)
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
        .execute(&mut **transaction)
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
            raw_event
        FROM
            events
        WHERE
            id
        IN (
            SELECT
                event_id
            FROM
                lww_element_latest_reference_bytes
            WHERE
                system_key_type = $1
            AND
                system_key = $2
            AND
                content_type = $3
            AND
                subject = $4
        )
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(i64::try_from(content_type)?)
        .bind(subject)
        .fetch_optional(&mut **transaction)
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
            raw_event
        FROM
            events
        WHERE
            id
        IN (
            SELECT
                event_id
            FROM
                lww_element_latest_reference_pointer
            WHERE
                system_key_type = $1
            AND
                system_key = $2
            AND
                content_type = $3
            AND
                subject_system_key_type = $4
            AND
                subject_system_key = $5
            AND
                subject_process = $6
            AND
                subject_logical_clock = $7
        )
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
        .fetch_optional(&mut **transaction)
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
                transaction,
                system,
                content_type,
                pointer,
            )
            .await?
        }
        crate::model::reference::Reference::Bytes(bytes) => {
            load_previous_with_bytes(transaction, system, content_type, bytes)
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
                transaction,
                pointer,
                content_type,
                operation,
            )
            .await?;
        }
        crate::model::reference::Reference::Bytes(bytes) => {
            upsert_count_references_bytes(
                transaction,
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
                transaction,
                pointer,
                value,
                content_type,
                operation,
            )
            .await?;
        }
        crate::model::reference::Reference::Bytes(bytes) => {
            upsert_count_lww_element_references_bytes(
                transaction,
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

pub(crate) struct EventWithRowId {
    pub(crate) event_id: u64,
    pub(crate) event: crate::model::event::Event,
}

pub(crate) async fn update_lww_element_reference_bytes_batch(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    mutations: &Vec<EventWithRowId>,
) -> ::anyhow::Result<()> {
    let query_bytes = "
        INSERT INTO lww_element_latest_reference_bytes (
            event_id,
            system_key_type,
            system_key,
            process,
            content_type,
            lww_element_unix_milliseconds,
            subject
        )
            SELECT DISTINCT ON (
                system_key_type,
                system_key,
                content_type,
                subject
            ) * FROM UNNEST (
                $1::bigint[],
                $2::bigint[],
                $3::bytea[],
                $4::bytea[],
                $5::bigint[],
                $6::bigint[],
                $7::bytea[]
            ) as p (
                event_id,
                system_key_type,
                system_key,
                process,
                content_type,
                lww_element_unix_milliseconds,
                subject
            )
            ORDER BY
                system_key_type,
                system_key,
                content_type,
                subject,
                lww_element_unix_milliseconds DESC
        ON CONFLICT (
            system_key_type,
            system_key,
            content_type,
            subject
        )
        DO UPDATE
        SET
            event_id = EXCLUDED.event_id,
            process = EXCLUDED.process,
            lww_element_unix_milliseconds = EXCLUDED.lww_element_unix_milliseconds
        WHERE
            (
                EXCLUDED.lww_element_unix_milliseconds,
                EXCLUDED.process
            )
            >
            (
                lww_element_latest_reference_bytes.lww_element_unix_milliseconds,
                lww_element_latest_reference_bytes.process
            );
    ";

    let mut event_id = vec![];
    let mut system_key_type = vec![];
    let mut system_key = vec![];
    let mut process = vec![];
    let mut content_type = vec![];
    let mut unix_milliseconds = vec![];
    let mut p_bytes = vec![];

    for row in mutations {
        if let Some(lww_element) = row.event.lww_element() {
            if let Some(reference) = row.event.references().first() {
                match reference {
                    crate::model::reference::Reference::Bytes(bytes) => {
                        event_id.push(i64::try_from(row.event_id)?);
                        system_key_type.push(i64::try_from(
                            crate::model::public_key::get_key_type(
                                row.event.system(),
                            ),
                        )?);
                        system_key.push(
                            crate::model::public_key::get_key_bytes(
                                row.event.system(),
                            ),
                        );
                        process.push(row.event.process().bytes());
                        content_type
                            .push(i64::try_from(*row.event.content_type())?);
                        unix_milliseconds.push(i64::try_from(
                            lww_element.unix_milliseconds,
                        )?);
                        p_bytes.push(bytes.clone());
                    }
                    _ => {}
                }
            }
        }
    }

    if event_id.len() > 0 {
        ::sqlx::query(query_bytes)
            .bind(event_id)
            .bind(system_key_type)
            .bind(system_key)
            .bind(process)
            .bind(content_type)
            .bind(unix_milliseconds)
            .bind(p_bytes)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}

pub(crate) async fn update_lww_element_reference(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    event: &crate::model::event::Event,
) -> ::anyhow::Result<()> {
    let query_bytes = "
        INSERT INTO lww_element_latest_reference_bytes (
            event_id,
            system_key_type,
            system_key,
            process,
            content_type,
            lww_element_unix_milliseconds,
            subject
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (
            system_key_type,
            system_key,
            content_type,
            subject
        )
        DO UPDATE
        SET
            event_id = $1,
            process = $4,
            lww_element_unix_milliseconds = $6
        WHERE
            (
                EXCLUDED.lww_element_unix_milliseconds,
                EXCLUDED.process
            )
            >
            (
                lww_element_latest_reference_bytes.lww_element_unix_milliseconds,
                lww_element_latest_reference_bytes.process
            );
    ";

    let query_pointer = "
        INSERT INTO lww_element_latest_reference_pointer (
            event_id,
            system_key_type,
            system_key,
            process,
            content_type,
            lww_element_unix_milliseconds,
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (
            system_key_type,
            system_key,
            content_type,
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock
        )
        DO UPDATE
        SET
            event_id = $1,
            process = $4,
            lww_element_unix_milliseconds = $6
        WHERE
            (
                EXCLUDED.lww_element_unix_milliseconds,
                EXCLUDED.process
            )
            >
            (
                lww_element_latest_reference_pointer.lww_element_unix_milliseconds,
                lww_element_latest_reference_pointer.process
            );
    ";

    if let Some(lww_element) = event.lww_element() {
        if let Some(reference) = event.references().first() {
            match reference {
                crate::model::reference::Reference::Pointer(pointer) => {
                    ::sqlx::query(query_pointer)
                        .bind(i64::try_from(event_id)?)
                        .bind(i64::try_from(
                            crate::model::public_key::get_key_type(
                                event.system(),
                            ),
                        )?)
                        .bind(crate::model::public_key::get_key_bytes(
                            event.system(),
                        ))
                        .bind(event.process().bytes())
                        .bind(i64::try_from(*event.content_type())?)
                        .bind(i64::try_from(lww_element.unix_milliseconds)?)
                        .bind(i64::try_from(
                            crate::model::public_key::get_key_type(
                                pointer.system(),
                            ),
                        )?)
                        .bind(crate::model::public_key::get_key_bytes(
                            pointer.system(),
                        ))
                        .bind(pointer.process().bytes())
                        .bind(i64::try_from(*pointer.logical_clock())?)
                        .execute(&mut **transaction)
                        .await?;
                }
                crate::model::reference::Reference::Bytes(bytes) => {
                    ::sqlx::query(query_bytes)
                        .bind(i64::try_from(event_id)?)
                        .bind(i64::try_from(
                            crate::model::public_key::get_key_type(
                                event.system(),
                            ),
                        )?)
                        .bind(crate::model::public_key::get_key_bytes(
                            event.system(),
                        ))
                        .bind(event.process().bytes())
                        .bind(i64::try_from(*event.content_type())?)
                        .bind(i64::try_from(lww_element.unix_milliseconds)?)
                        .bind(bytes)
                        .execute(&mut **transaction)
                        .await?;
                }
                _ => {}
            }
        }
    }

    Ok(())
}

pub(crate) async fn update_counts(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &crate::model::event::Event,
    content: &crate::model::content::Content,
) -> ::anyhow::Result<()> {
    for reference in event.references().iter() {
        upsert_count_references(
            transaction,
            reference,
            *event.content_type(),
            Operation::Increment,
        )
        .await?;
    }

    if let crate::model::content::Content::Delete(body) = &content {
        let potential_existing = crate::postgres::load_event(
            transaction,
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
                    transaction,
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
                    transaction,
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
                            transaction,
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
                transaction,
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
