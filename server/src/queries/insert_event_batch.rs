use ::protobuf::Message;
use ::std::collections::HashMap;

#[derive(PartialEq)]
pub(crate) struct EventIdWithLayers {
    id: i64,
    layers: crate::model::EventLayers,
}

impl EventIdWithLayers {
    pub fn id(&self) -> i64 {
        self.id
    }

    pub fn layers(&self) -> &crate::model::EventLayers {
        &self.layers
    }
}

#[derive(::sqlx::FromRow)]
struct ResultRow {
    id: i64,
    #[sqlx(try_from = "i64")]
    system_key_type: u64,
    system_key: ::std::vec::Vec<u8>,
    process: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    logical_clock: u64,
}

#[derive(::postgres_from_row::FromRow)]
struct ResultRow2 {
    id: i64,
    system_key_type: i64,
    system_key: ::std::vec::Vec<u8>,
    process: ::std::vec::Vec<u8>,
    logical_clock: i64,
}

pub(crate) async fn prepare(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/insert_event_batch.sql"))
        .await?;

    Ok(statement)
}

pub(crate) fn parse_rows(
    batch: &HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
    rows: &Vec<::tokio_postgres::Row>,
) -> ::anyhow::Result<HashMap<crate::model::InsecurePointer, EventIdWithLayers>>
{
    let mut result = HashMap::new();

    for row in rows {
        let parsed_row: ResultRow2 =
            ::postgres_from_row::FromRow::try_from_row(&row)?;

        let pointer = crate::model::InsecurePointer::new(
            crate::model::public_key::from_type_and_bytes(
                u64::try_from(parsed_row.system_key_type)?,
                &parsed_row.system_key,
            )?,
            crate::model::process::from_vec(&parsed_row.process)?,
            u64::try_from(parsed_row.logical_clock)?,
        );

        if let Some(layers) = batch.get(&pointer) {
            result.insert(
                pointer,
                EventIdWithLayers {
                    id: parsed_row.id,
                    layers: layers.clone(),
                },
            );
        }
    }

    Ok(result)
}

pub(crate) async fn insert(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: &HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
    server_time: u64,
) -> ::anyhow::Result<Vec<::tokio_postgres::Row>> {
    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_process = vec![];
    let mut p_logical_clock = vec![];
    let mut p_content_type = vec![];
    let mut p_content = vec![];
    let mut p_vector_clock = vec![];
    let mut p_indices = vec![];
    let mut p_signature = vec![];
    let mut p_raw_event = vec![];
    let mut p_server_time = vec![];
    let mut p_unix_milliseconds = vec![];

    for layers in batch.values() {
        p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(layers.event().system()),
        )?);

        p_system_key.push(crate::model::public_key::get_key_bytes(
            layers.event().system(),
        ));

        p_process.push(layers.event().process().bytes());

        p_logical_clock.push(i64::try_from(*layers.event().logical_clock())?);

        p_content_type.push(i64::try_from(*layers.event().content_type())?);

        p_content.push(layers.event().content().clone());

        p_vector_clock.push(layers.event().vector_clock().write_to_bytes()?);

        p_indices.push(layers.event().indices().write_to_bytes()?);

        p_signature.push(layers.signed_event().signature().clone());

        p_raw_event.push(layers.raw_event().clone());

        p_server_time.push(i64::try_from(server_time)?);

        p_unix_milliseconds.push(
            layers
                .event()
                .unix_milliseconds()
                .map(i64::try_from)
                .transpose()?,
        );
    }

    let statement = prepare(&transaction).await?;

    Ok(transaction
        .query(
            &statement,
            &[
                &p_system_key_type,
                &p_system_key,
                &p_process,
                &p_logical_clock,
                &p_content_type,
                &p_content,
                &p_vector_clock,
                &p_indices,
                &p_signature,
                &p_raw_event,
                &p_server_time,
                &p_unix_milliseconds,
            ],
        )
        .await?)
}

pub(crate) async fn insert_event_batch(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: &mut HashMap<
        crate::model::InsecurePointer,
        crate::model::EventLayers,
    >,
    server_time: u64,
) -> ::anyhow::Result<HashMap<crate::model::InsecurePointer, EventIdWithLayers>>
{
    let query = "
        INSERT INTO events
        (
            system_key_type,
            system_key,
            process,
            logical_clock,
            content_type,
            content,
            vector_clock,
            indices,
            signature,
            raw_event,
            server_time,
            unix_milliseconds
        )
        SELECT * FROM UNNEST (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        ) as p (
            system_key_type,
            system_key,
            process,
            logical_clock,
            content_type,
            content,
            vector_clock,
            indices,
            signature,
            raw_event,
            server_time,
            unix_milliseconds
        )
        WHERE (
            system_key_type,
            system_key,
            process,
            logical_clock
        ) NOT IN (
            SELECT
                system_key_type,
                system_key,
                process,
                logical_clock
            FROM
                deletions
            WHERE
                deletions.system_key_type = system_key_type
            AND
                deletions.system_key = system_key
            AND
                deletions.process = process
            AND
                deletions.logical_clock = logical_clock
        )
        ORDER BY
            system_key_type,
            system_key,
            process,
            logical_clock
        ON CONFLICT DO NOTHING
        RETURNING
            id,
            system_key_type,
            system_key,
            process,
            logical_clock;
    ";

    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_process = vec![];
    let mut p_logical_clock = vec![];
    let mut p_content_type = vec![];
    let mut p_content = vec![];
    let mut p_vector_clock = vec![];
    let mut p_indices = vec![];
    let mut p_signature = vec![];
    let mut p_raw_event = vec![];
    let mut p_server_time = vec![];
    let mut p_unix_milliseconds = vec![];

    for layers in batch.values() {
        p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(layers.event().system()),
        )?);

        p_system_key.push(crate::model::public_key::get_key_bytes(
            layers.event().system(),
        ));

        p_process.push(layers.event().process().bytes());

        p_logical_clock.push(i64::try_from(*layers.event().logical_clock())?);

        p_content_type.push(i64::try_from(*layers.event().content_type())?);

        p_content.push(layers.event().content().clone());

        p_vector_clock.push(layers.event().vector_clock().write_to_bytes()?);

        p_indices.push(layers.event().indices().write_to_bytes()?);

        p_signature.push(layers.signed_event().signature().clone());

        p_raw_event.push(layers.raw_event().clone());

        p_server_time.push(i64::try_from(server_time)?);

        p_unix_milliseconds.push(
            layers
                .event()
                .unix_milliseconds()
                .map(i64::try_from)
                .transpose()?,
        );
    }

    let rows = ::sqlx::query_as::<_, ResultRow>(query)
        .bind(p_system_key_type)
        .bind(p_system_key)
        .bind(p_process)
        .bind(p_logical_clock)
        .bind(p_content_type)
        .bind(p_content)
        .bind(p_vector_clock)
        .bind(p_indices)
        .bind(p_signature)
        .bind(p_raw_event)
        .bind(p_server_time)
        .bind(p_unix_milliseconds)
        .fetch_all(&mut **transaction)
        .await
        .map_err(::anyhow::Error::new)?;

    let mut result = HashMap::new();

    for row in rows {
        let pointer = crate::model::InsecurePointer::new(
            crate::model::public_key::from_type_and_bytes(
                row.system_key_type,
                &row.system_key,
            )?,
            crate::model::process::from_vec(&row.process)?,
            u64::try_from(row.logical_clock)?,
        );

        if let Some(layers) = batch.get(&pointer) {
            result.insert(
                pointer,
                EventIdWithLayers {
                    id: row.id,
                    layers: layers.clone(),
                },
            );
        }
    }

    Ok(result)
}

#[cfg(test)]
pub mod tests {
    use ::std::collections::HashMap;

    #[::sqlx::test]
    async fn insert_event_batch(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let keypair = crate::model::tests::make_test_keypair();
        let process = crate::model::tests::make_test_process();

        let signed_event =
            crate::model::tests::make_test_event(&keypair, &process, 52);

        let layers = crate::model::EventLayers::new(signed_event)?;

        let server_time = ::std::time::SystemTime::now()
            .duration_since(::std::time::SystemTime::UNIX_EPOCH)?
            .as_secs();

        let mut batch = HashMap::new();

        batch.insert(
            crate::model::InsecurePointer::from_event(layers.event()),
            layers,
        );

        let mut transaction = pool.begin().await?;

        crate::postgres::prepare_database(&mut transaction).await?;

        let result1 = crate::queries::insert_event_batch::insert_event_batch(
            &mut transaction,
            &mut batch,
            server_time,
        )
        .await?;

        let result2 = crate::queries::insert_event_batch::insert_event_batch(
            &mut transaction,
            &mut batch,
            server_time,
        )
        .await?;

        transaction.commit().await?;

        assert!(result1.len() == 1);
        assert!(result2.len() == 0);

        Ok(())
    }
}
