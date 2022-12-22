use ::protobuf::Message;
use ::std::convert::TryFrom;

pub mod store_item {
    #[derive(PartialEq, Debug)]
    pub enum MutationPointerOrSignedEvent {
        MutationPointer(crate::model::pointer::Pointer),
        SignedEvent(crate::model::signed_event::SignedEvent),
    }

    #[derive(PartialEq, Debug)]
    pub struct StoreItem {
        pointer: crate::model::pointer::Pointer,
        value: MutationPointerOrSignedEvent,
    }

    impl StoreItem {
        pub fn new(
            pointer: crate::model::pointer::Pointer,
            value: MutationPointerOrSignedEvent,
        ) -> StoreItem {
            StoreItem {
                pointer: pointer,
                value: value,
            }
        }

        pub fn pointer(&self) -> &crate::model::pointer::Pointer {
            &self.pointer
        }

        pub fn value(&self) -> &MutationPointerOrSignedEvent {
            &self.value
        }
    }
}

pub(crate) fn signed_event_to_store_item(
    signed_event: crate::model::signed_event::SignedEvent,
) -> store_item::StoreItem {
    let event = signed_event.event();

    store_item::StoreItem::new(
        crate::model::pointer::Pointer::new(
            event.identity().clone(),
            event.writer().clone(),
            event.sequence_number(),
        ),
        store_item::MutationPointerOrSignedEvent::SignedEvent(signed_event),
    )
}

pub(crate) async fn prepare_database(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::sqlx::Result<()> {
    ::sqlx::query(
        "
        DO $$ BEGIN
            CREATE TYPE pointer AS (
                public_key      BYTEA,
                writer_id       BYTEA,
                sequence_number INT8
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS events (
            author_public_key BYTEA NOT NULL,
            writer_id         BYTEA NOT NULL,
            sequence_number   INT8  NOT NULL,
            unix_milliseconds INT8  NOT NULL,
            content           BYTEA NOT NULL,
            signature         BYTEA NOT NULL,
            clocks            TEXT  NOT NULL,
            event_type        INT8  NOT NULL,
            mutation_pointer  pointer
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE UNIQUE INDEX IF NOT EXISTS events_index
        ON events (author_public_key, writer_id, sequence_number);
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS notifications (
            notification_id        INT8  NOT NULL,
            for_author_public_key  BYTEA NOT NULL,
            from_author_public_key BYTEA NOT NULL,
            from_writer_id         BYTEA NOT NULL,
            from_sequence_number   INT8  NOT NULL
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE UNIQUE INDEX IF NOT EXISTS notifications_index
        ON notifications (for_author_public_key, notification_id);
    ",
    )
    .execute(&mut *transaction)
    .await?;

    Ok(())
}

pub(crate) async fn persist_event_feed(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO events
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING;
    ";

    let query_with_pointer = "
        INSERT INTO events
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ROW($9, $10, $11))
        ON CONFLICT (author_public_key, writer_id, sequence_number)
        DO UPDATE SET
            unix_milliseconds = EXCLUDED.unix_milliseconds,
            content = EXCLUDED.content,
            signature = EXCLUDED.signature,
            clocks = EXCLUDED.clocks,
            event_type = EXCLUDED.event_type,
            mutation_pointer = EXCLUDED.mutation_pointer
        ;
    ";

    let event = signed_event.event();

    let event_body =
        crate::protocol::EventBody::parse_from_bytes(event.content())?;

    let mut message_type: i64 = 0;

    if event_body.has_message() {
        message_type = 1;
    } else if event_body.has_profile() {
        message_type = 2;
    } else if event_body.has_delete() {
        message_type = 6;
    }

    let mut converted_clocks = vec![];

    for clock in event.clocks() {
        converted_clocks.push(crate::ClockEntry {
            writer_id: clock.writer().0.to_vec().clone(),
            sequence_number: clock.value(),
        });
    }

    let clocks_serialized = ::serde_json::to_string(&converted_clocks)?;

    ::sqlx::query(query)
        .bind(&event.identity().to_bytes())
        .bind(&event.writer().0)
        .bind(i64::try_from(event.sequence_number())?)
        .bind(i64::try_from(event.unix_milliseconds())?)
        .bind(&event.content())
        .bind(&signed_event.signature().to_bytes())
        .bind(clocks_serialized)
        .bind(message_type)
        .execute(&mut *transaction)
        .await?;

    if event_body.has_delete() {
        sqlx::query(query_with_pointer)
            .bind(event_body.delete().pointer.public_key.clone())
            .bind(event_body.delete().pointer.writer_id.clone())
            .bind(i64::try_from(event_body.delete().pointer.sequence_number)?)
            .bind(0)
            .bind::<::std::vec::Vec<u8>>(vec![])
            .bind::<::std::vec::Vec<u8>>(vec![])
            .bind("")
            .bind(10)
            .bind(&event.identity().to_bytes())
            .bind(&event.writer().0)
            .bind(i64::try_from(event.sequence_number())?)
            .execute(&mut *transaction)
            .await?;
    }

    Ok(())
}

pub fn event_row_to_store_item(
    row: &crate::EventRow,
) -> ::anyhow::Result<store_item::StoreItem> {
    let identity =
        ::ed25519_dalek::PublicKey::from_bytes(&row.author_public_key)?;

    let writer = crate::model::vec_to_writer_id(&row.writer_id)?;

    let pointer = crate::model::pointer::Pointer::new(
        identity,
        writer,
        u64::try_from(row.sequence_number)?,
    );

    if let Some(mutation_pointer) = &row.mutation_pointer {
        let identity = ::ed25519_dalek::PublicKey::from_bytes(
            &mutation_pointer.public_key,
        )?;

        let writer =
            crate::model::vec_to_writer_id(&mutation_pointer.writer_id)?;

        let mutation_pointer = crate::model::pointer::Pointer::new(
            identity,
            writer,
            u64::try_from(mutation_pointer.sequence_number)?,
        );

        return Ok(store_item::StoreItem::new(
            pointer.clone(),
            store_item::MutationPointerOrSignedEvent::MutationPointer(
                mutation_pointer,
            ),
        ));
    }

    let clocks_deserialized: ::std::vec::Vec<crate::ClockEntry> =
        ::serde_json::from_str(&row.clocks)?;

    let clocks = clocks_deserialized.iter().map(|clock| {
        let key = crate::model::vec_to_writer_id(
            &clock.writer_id,
        )?;

        Ok(crate::model::event::Clock::new(
            key,
            clock.sequence_number,
        ))
    }).collect::<
        ::anyhow::Result<::std::vec::Vec<crate::model::event::Clock>>
    >()?;

    let event = crate::model::event::Event::new(
        pointer.identity().clone(),
        pointer.writer().clone(),
        pointer.sequence_number(),
        u64::try_from(row.unix_milliseconds)?,
        row.content.clone(),
        clocks,
    );

    let signature = ed25519_dalek::Signature::try_from(&row.signature[..])?;

    let signed_event =
        crate::model::signed_event::SignedEvent::new(event, signature)?;

    Ok(store_item::StoreItem::new(
        pointer.clone(),
        store_item::MutationPointerOrSignedEvent::SignedEvent(signed_event),
    ))
}

pub async fn get_specific_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    pointer: &crate::model::pointer::Pointer,
) -> ::anyhow::Result<Option<store_item::StoreItem>> {
    const STATEMENT: &str = "
        SELECT * FROM events
        WHERE author_public_key = $1
        AND writer_id = $2
        AND sequence_number = $3
        LIMIT 1;
    ";

    let potential_row = ::sqlx::query_as::<_, crate::EventRow>(STATEMENT)
        .bind(&pointer.identity().to_bytes())
        .bind(&pointer.writer().0)
        .bind(i64::try_from(pointer.sequence_number())?)
        .fetch_optional(&mut *transaction)
        .await?;

    let row = match potential_row {
        Some(x) => x,
        None => return Ok(None),
    };

    let store_item = event_row_to_store_item(&row)?;

    Ok(Some(store_item))
}

#[derive(::sqlx::FromRow, PartialEq)]
pub struct StartAndEnd {
    pub start_number: i64,
    pub end_number: i64,
}

pub async fn ranges_for_writer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    identity: &::ed25519_dalek::PublicKey,
    writer: &crate::model::WriterId,
) -> ::sqlx::Result<::std::vec::Vec<StartAndEnd>> {
    const STATEMENT: &str = "
        SELECT
            MIN(sequence_number) as start_number,
            MAX(sequence_number) as end_number
        FROM (
            SELECT *, ROW_NUMBER() OVER(ORDER BY sequence_number) as rn
            FROM events
            WHERE author_public_key = $1
            AND writer_id = $2
        ) t
        GROUP BY sequence_number - rn;
    ";

    ::sqlx::query_as::<_, StartAndEnd>(STATEMENT)
        .bind(&identity.to_bytes())
        .bind(&writer.0)
        .fetch_all(&mut *transaction)
        .await
}

#[derive(sqlx::FromRow, PartialEq, Debug)]
pub struct WriterAndLargest {
    pub writer_id: ::std::vec::Vec<u8>,
    pub largest_sequence_number: i64,
}

pub async fn writer_heads_for_identity(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    identity: &::ed25519_dalek::PublicKey,
) -> ::sqlx::Result<::std::vec::Vec<WriterAndLargest>> {
    const STATEMENT: &str = "
        SELECT writer_id, MAX(sequence_number) as largest_sequence_number
        FROM events
        WHERE author_public_key = $1
        GROUP BY writer_id
        ORDER BY largest_sequence_number DESC;
    ";

    ::sqlx::query_as::<_, WriterAndLargest>(STATEMENT)
        .bind(&identity.to_bytes())
        .fetch_all(&mut *transaction)
        .await
}

pub async fn load_range(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    identity: &::ed25519_dalek::PublicKey,
    writer: &crate::model::WriterId,
    low: u64,
    high: u64,
) -> ::anyhow::Result<::std::vec::Vec<store_item::StoreItem>> {
    const STATEMENT: &str = "
        SELECT *
        FROM events
        WHERE author_public_key = $1
        AND writer_id = $2
        AND sequence_number >= $3
        AND sequence_number <= $4
    ";

    let range = ::sqlx::query_as::<_, crate::EventRow>(STATEMENT)
        .bind(&identity.to_bytes())
        .bind(&writer.0)
        .bind(i64::try_from(low)?)
        .bind(i64::try_from(high)?)
        .fetch_all(&mut *transaction)
        .await?;

    range
        .iter()
        .map(|row| event_row_to_store_item(row))
        .collect::<::anyhow::Result<::std::vec::Vec<store_item::StoreItem>>>()
}

pub async fn load_events_before_time(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    before_time: Option<u64>,
) -> ::anyhow::Result<::std::vec::Vec<store_item::StoreItem>> {
    const STATEMENT_WITHOUT_TIME: &str = "
        SELECT *
        FROM events
        WHERE event_type = 1
        ORDER BY unix_milliseconds DESC
        LIMIT 20
    ";

    const STATEMENT_WITH_TIME: &str = "
        SELECT *
        FROM events
        WHERE event_type = 1
        AND unix_milliseconds < $1
        ORDER BY unix_milliseconds DESC
        LIMIT 20
    ";

    let history: ::std::vec::Vec<crate::EventRow>;

    if let Some(before_time) = before_time {
        history = ::sqlx::query_as::<_, crate::EventRow>(STATEMENT_WITH_TIME)
            .bind(i64::try_from(before_time)?)
            .fetch_all(&mut *transaction)
            .await?
    } else {
        history = ::sqlx::query_as::<_, crate::EventRow>(STATEMENT_WITHOUT_TIME)
            .fetch_all(&mut *transaction)
            .await?
    }

    history
        .iter()
        .map(|row| event_row_to_store_item(row))
        .collect::<::anyhow::Result<::std::vec::Vec<store_item::StoreItem>>>()
}

pub async fn load_latest_profile(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    identity: &::ed25519_dalek::PublicKey,
) -> ::anyhow::Result<Option<crate::model::signed_event::SignedEvent>> {
    const STATEMENT: &str = "
        SELECT * FROM events
        WHERE author_public_key = $1
        AND event_type = 2
        ORDER BY unix_milliseconds DESC
        LIMIT 1;
    ";

    let potential_row = ::sqlx::query_as::<_, crate::EventRow>(STATEMENT)
        .bind(&identity.to_bytes())
        .fetch_optional(&mut *transaction)
        .await?;

    let row = match potential_row {
        Some(x) => x,
        None => return Ok(None),
    };

    let store_item = event_row_to_store_item(&row)?;

    match store_item.value() {
        crate::postgres::store_item::
             MutationPointerOrSignedEvent::SignedEvent(signed_event)
        => Ok(Some(signed_event.clone())),
        _ => Ok(None),
    }
}

#[derive(sqlx::FromRow)]
struct PublicKeyRow {
    author_public_key: ::std::vec::Vec<u8>,
}

pub async fn load_random_identities(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<::std::vec::Vec<::ed25519_dalek::PublicKey>> {
    const STATEMENT: &str = "
        SELECT * FROM (
            SELECT author_public_key 
            FROM events
            GROUP BY author_public_key
            HAVING COUNT(*) > 1
        ) t
        ORDER BY RANDOM()
        LIMIT 3;
    ";

    let rows = ::sqlx::query_as::<_, PublicKeyRow>(STATEMENT)
        .fetch_all(&mut *transaction)
        .await?;

    rows.iter().map(|row| {
        let key = ::ed25519_dalek::PublicKey::from_bytes(
            &row.author_public_key
        )?;
        Ok(key)
    }).collect::<
        ::anyhow::Result<::std::vec::Vec<::ed25519_dalek::PublicKey>>
    >()
}

#[cfg(test)]
pub mod tests {
    use ::protobuf::Message;

    #[::sqlx::test]
    async fn test_prepare_database(pool: ::sqlx::PgPool) -> ::sqlx::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    #[::sqlx::test]
    async fn ranges_for_writer_none(
        pool: ::sqlx::PgPool,
    ) -> ::sqlx::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer_keypair = crate::crypto::tests::make_test_keypair();

        let result = crate::postgres::ranges_for_writer(
            &mut transaction,
            &identity_keypair.public,
            &crate::model::WriterId(writer_keypair.public.to_bytes().clone()),
        )
        .await?;

        transaction.commit().await?;

        let expected: ::std::vec::Vec<crate::postgres::StartAndEnd> = vec![];

        assert!(result == expected);

        Ok(())
    }

    #[::sqlx::test]
    async fn get_item_that_does_not_exist(
        pool: ::sqlx::PgPool,
    ) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer_keypair = crate::crypto::tests::make_test_keypair();

        let pointer = crate::model::pointer::Pointer::new(
            identity_keypair.public.clone(),
            crate::model::WriterId(writer_keypair.public.to_bytes().clone()),
            5,
        );

        let loaded =
            crate::postgres::get_specific_event(&mut transaction, &pointer)
                .await?;

        transaction.commit().await?;

        assert!(loaded == None);

        Ok(())
    }

    #[::sqlx::test]
    async fn load_range_that_does_not_exist(
        pool: ::sqlx::PgPool,
    ) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer_keypair = crate::crypto::tests::make_test_keypair();

        let loaded = crate::postgres::load_range(
            &mut transaction,
            &identity_keypair.public,
            &crate::model::WriterId(writer_keypair.public.to_bytes().clone()),
            5,
            10,
        )
        .await?;

        transaction.commit().await?;

        assert!(loaded == vec![]);

        Ok(())
    }

    #[::sqlx::test]
    async fn writer_heads_for_identity_that_does_not_exist(
        pool: ::sqlx::PgPool,
    ) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();

        let loaded = crate::postgres::writer_heads_for_identity(
            &mut transaction,
            &identity_keypair.public,
        )
        .await?;

        transaction.commit().await?;

        assert!(loaded == vec![]);

        Ok(())
    }

    fn make_test_event(
        keypair: &::ed25519_dalek::Keypair,
        writer: &crate::model::WriterId,
        sequence_number: u64,
    ) -> ::anyhow::Result<crate::model::signed_event::SignedEvent> {
        let event_body_message = crate::protocol::EventBodyMessage::new();
        let mut event_body = crate::protocol::EventBody::new();
        event_body.set_message(event_body_message);

        let event = crate::model::event::Event::new(
            keypair.public.clone(),
            writer.clone(),
            sequence_number,
            100,
            event_body.write_to_bytes()?,
            vec![crate::model::event::Clock::new(writer.clone(), 5)],
        );

        let signed_event =
            crate::model::signed_event::SignedEvent::sign(event, &keypair);

        Ok(signed_event)
    }

    fn generate_writer_id() -> crate::model::WriterId {
        crate::model::WriterId(
            crate::crypto::tests::make_test_keypair()
                .public
                .to_bytes()
                .clone(),
        )
    }

    #[::sqlx::test]
    async fn load_range(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer = generate_writer_id();

        let e3 = make_test_event(&identity_keypair, &writer, 3)?;
        let e5 = make_test_event(&identity_keypair, &writer, 5)?;
        let e7 = make_test_event(&identity_keypair, &writer, 7)?;
        let e9 = make_test_event(&identity_keypair, &writer, 9)?;

        crate::postgres::persist_event_feed(&mut transaction, &e3).await?;
        crate::postgres::persist_event_feed(&mut transaction, &e5).await?;
        crate::postgres::persist_event_feed(&mut transaction, &e7).await?;
        crate::postgres::persist_event_feed(&mut transaction, &e9).await?;

        let other_identity_keypair = crate::crypto::tests::make_test_keypair();
        let other_writer = generate_writer_id();

        let o6 = make_test_event(&other_identity_keypair, &other_writer, 6)?;
        crate::postgres::persist_event_feed(&mut transaction, &o6).await?;

        let result = crate::postgres::load_range(
            &mut transaction,
            &identity_keypair.public,
            &writer,
            5,
            7,
        )
        .await?;

        let expected = vec![
            crate::postgres::signed_event_to_store_item(e5),
            crate::postgres::signed_event_to_store_item(e7),
        ];

        transaction.commit().await?;

        assert!(result == expected);

        Ok(())
    }

    #[::sqlx::test]
    async fn writer_heads_for_identity(
        pool: ::sqlx::PgPool,
    ) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer1 = generate_writer_id();
        let writer2 = generate_writer_id();

        let w1e3 = make_test_event(&identity_keypair, &writer1, 3)?;
        let w1e5 = make_test_event(&identity_keypair, &writer1, 5)?;
        let w2e7 = make_test_event(&identity_keypair, &writer2, 7)?;

        crate::postgres::persist_event_feed(&mut transaction, &w1e3).await?;
        crate::postgres::persist_event_feed(&mut transaction, &w1e5).await?;
        crate::postgres::persist_event_feed(&mut transaction, &w2e7).await?;

        let result = crate::postgres::writer_heads_for_identity(
            &mut transaction,
            &identity_keypair.public,
        )
        .await?;

        transaction.commit().await?;

        let expected = vec![
            crate::postgres::WriterAndLargest {
                writer_id: writer2.0.to_vec(),
                largest_sequence_number: 7,
            },
            crate::postgres::WriterAndLargest {
                writer_id: writer1.0.to_vec(),
                largest_sequence_number: 5,
            },
        ];

        assert!(result == expected);

        Ok(())
    }

    #[::sqlx::test]
    async fn ranges_for_writer(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer1 = generate_writer_id();
        let writer2 = generate_writer_id();

        let w1e3 = make_test_event(&identity_keypair, &writer1, 3)?;
        let w1e4 = make_test_event(&identity_keypair, &writer1, 4)?;
        let w1e8 = make_test_event(&identity_keypair, &writer1, 8)?;
        let w2e7 = make_test_event(&identity_keypair, &writer2, 7)?;

        crate::postgres::persist_event_feed(&mut transaction, &w1e3).await?;
        crate::postgres::persist_event_feed(&mut transaction, &w1e4).await?;
        crate::postgres::persist_event_feed(&mut transaction, &w1e8).await?;
        crate::postgres::persist_event_feed(&mut transaction, &w2e7).await?;

        let result = crate::postgres::ranges_for_writer(
            &mut transaction,
            &identity_keypair.public,
            &writer1,
        )
        .await?;

        transaction.commit().await?;

        let expected = vec![
            crate::postgres::StartAndEnd {
                start_number: 3,
                end_number: 4,
            },
            crate::postgres::StartAndEnd {
                start_number: 8,
                end_number: 8,
            },
        ];

        assert!(result == expected);

        Ok(())
    }

    #[::sqlx::test]
    async fn store_and_get_item(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer_keypair = crate::crypto::tests::make_test_keypair();
        let other_writer_keypair = crate::crypto::tests::make_test_keypair();

        let writer =
            crate::model::WriterId(writer_keypair.public.to_bytes().clone());

        let event_body_message = crate::protocol::EventBodyMessage::new();
        let mut event_body = crate::protocol::EventBody::new();
        event_body.set_message(event_body_message);

        let event = crate::model::event::Event::new(
            identity_keypair.public.clone(),
            writer.clone(),
            5,
            100,
            event_body.write_to_bytes()?,
            vec![
                crate::model::event::Clock::new(writer.clone(), 5),
                crate::model::event::Clock::new(
                    crate::model::WriterId(
                        other_writer_keypair.public.to_bytes().clone(),
                    ),
                    12,
                ),
            ],
        );

        let signed_event = crate::model::signed_event::SignedEvent::sign(
            event,
            &identity_keypair,
        );

        crate::postgres::persist_event_feed(&mut transaction, &signed_event)
            .await?;

        let pointer = crate::model::pointer::Pointer::new(
            identity_keypair.public.clone(),
            writer.clone(),
            5,
        );

        let loaded =
            crate::postgres::get_specific_event(&mut transaction, &pointer)
                .await?;

        transaction.commit().await?;

        let expected = Some(crate::postgres::store_item::StoreItem::new(
            pointer,
            crate::postgres::store_item::
                MutationPointerOrSignedEvent::SignedEvent(
                    signed_event.clone(),
                ),
        ));

        assert!(loaded == expected);

        Ok(())
    }

    #[::sqlx::test]
    async fn delete_item_that_does_not_exist(
        pool: ::sqlx::PgPool,
    ) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer_keypair = crate::crypto::tests::make_test_keypair();
        let other_writer_keypair = crate::crypto::tests::make_test_keypair();

        let mut delete_pointer = crate::protocol::Pointer::new();
        delete_pointer.public_key =
            identity_keypair.public.to_bytes().to_vec().clone();
        delete_pointer.writer_id =
            writer_keypair.public.to_bytes().to_vec().clone();
        delete_pointer.sequence_number = 3;

        let mut event_body_delete = crate::protocol::EventBodyDelete::new();
        event_body_delete.pointer =
            ::protobuf::MessageField::some(delete_pointer);

        let mut event_body = crate::protocol::EventBody::new();
        event_body.set_delete(event_body_delete);

        let event = crate::model::event::Event::new(
            identity_keypair.public.clone(),
            crate::model::WriterId(writer_keypair.public.to_bytes().clone()),
            5,
            100,
            event_body.write_to_bytes()?,
            vec![
                crate::model::event::Clock::new(
                    crate::model::WriterId(
                        writer_keypair.public.to_bytes().clone(),
                    ),
                    5,
                ),
                crate::model::event::Clock::new(
                    crate::model::WriterId(
                        other_writer_keypair.public.to_bytes().clone(),
                    ),
                    12,
                ),
            ],
        );

        let signed_event = crate::model::signed_event::SignedEvent::sign(
            event,
            &identity_keypair,
        );

        crate::postgres::persist_event_feed(&mut transaction, &signed_event)
            .await?;

        let delete_event_pointer = crate::model::pointer::Pointer::new(
            identity_keypair.public.clone(),
            crate::model::WriterId(writer_keypair.public.to_bytes().clone()),
            5,
        );

        let loaded_delete = crate::postgres::get_specific_event(
            &mut transaction,
            &delete_event_pointer,
        )
        .await?;

        let deleted_event_pointer = crate::model::pointer::Pointer::new(
            identity_keypair.public.clone(),
            crate::model::WriterId(writer_keypair.public.to_bytes().clone()),
            3,
        );

        let loaded_deleted = crate::postgres::get_specific_event(
            &mut transaction,
            &deleted_event_pointer,
        )
        .await?;

        transaction.commit().await?;

        let expected_delete = Some(crate::postgres::store_item::StoreItem::new(
            delete_event_pointer.clone(),
            crate::postgres::store_item::
                MutationPointerOrSignedEvent::SignedEvent(
                    signed_event.clone(),
                ),
        ));

        let expected_deleted = Some(crate::postgres::store_item::StoreItem::new(
            deleted_event_pointer,
            crate::postgres::store_item::
                MutationPointerOrSignedEvent::MutationPointer(
                    delete_event_pointer.clone(),
                ),
        ));

        assert!(loaded_delete == expected_delete);
        assert!(loaded_deleted == expected_deleted);

        Ok(())
    }
}
