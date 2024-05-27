use ::std::collections::HashMap;

pub(crate) struct Batch {
    p_system_key_type: Vec<i64>,
    p_system_key: Vec<Vec<u8>>,
    p_process: Vec<Vec<u8>>,
    p_logical_clock: Vec<i64>,
    p_unix_milliseconds: Vec<Option<i64>>,
    p_content_type: Vec<i64>,
    p_event_id: Vec<Option<i64>>,
}

impl Batch {
    pub(crate) fn new() -> Batch {
        Batch {
            p_system_key_type: vec![],
            p_system_key: vec![],
            p_process: vec![],
            p_logical_clock: vec![],
            p_unix_milliseconds: vec![],
            p_content_type: vec![],
            p_event_id: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: Option<i64>,
        system: &crate::model::public_key::PublicKey,
        delete: &crate::model::delete::Delete,
    ) -> ::anyhow::Result<()> {
        self.p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(system),
        )?);

        self.p_system_key
            .push(crate::model::public_key::get_key_bytes(system));

        self.p_process.push(delete.process().bytes().to_vec());

        self.p_logical_clock
            .push(i64::try_from(*delete.logical_clock())?);

        self.p_unix_milliseconds
            .push(delete.unix_milliseconds().map(i64::try_from).transpose()?);

        self.p_content_type
            .push(i64::try_from(*delete.content_type())?);

        self.p_event_id
            .push(event_id.map(i64::try_from).transpose()?);

        Ok(())
    }
}

pub(crate) async fn prepare_delete(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/delete_event.sql"))
        .await?;

    Ok(statement)
}

pub(crate) async fn prepare_insert(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/insert_delete.sql"))
        .await?;

    Ok(statement)
}

pub(crate) fn parse_rows(
    rows: &Vec<::tokio_postgres::Row>,
) -> ::anyhow::Result<
    HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
> {
    let mut result = HashMap::new();

    for row in rows {
        let layers = crate::model::EventLayers::new(
            crate::model::signed_event::from_vec(row.try_get(0)?)?,
        )?;

        result.insert(
            crate::model::InsecurePointer::from_event(layers.event()),
            layers,
        );
    }

    Ok(result)
}

pub(crate) async fn insert(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: Batch,
) -> ::anyhow::Result<()> {
    if batch.p_system_key_type.len() > 0 {
        let statement = prepare_insert(&transaction).await?;

        transaction
            .query(
                &statement,
                &[
                    &batch.p_system_key_type,
                    &batch.p_system_key,
                    &batch.p_process,
                    &batch.p_logical_clock,
                    &batch.p_event_id,
                    &batch.p_unix_milliseconds,
                    &batch.p_content_type,
                ],
            )
            .await?;
    }

    Ok(())
}

pub(crate) async fn delete(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: Batch,
) -> ::anyhow::Result<Vec<::tokio_postgres::Row>> {
    if batch.p_system_key_type.len() > 0 {
        let statement = prepare_delete(&transaction).await?;

        Ok(transaction
            .query(
                &statement,
                &[
                    &batch.p_system_key_type,
                    &batch.p_system_key,
                    &batch.p_process,
                    &batch.p_logical_clock,
                ],
            )
            .await?)
    } else {
        Ok(vec![])
    }
}
