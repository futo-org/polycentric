pub(crate) struct Batch {
    p_value: Vec<Vec<u8>>,
    p_unix_milliseconds: Vec<i64>,
    p_event_id: Vec<i64>,
}

impl Batch {
    pub(crate) fn new() -> Batch {
        Batch {
            p_value: vec![],
            p_unix_milliseconds: vec![],
            p_event_id: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: i64,
        lww_element: &crate::protocol::LWWElement,
    ) -> ::anyhow::Result<()> {
        self.p_value.push(lww_element.value.clone());

        self.p_unix_milliseconds
            .push(i64::try_from(lww_element.unix_milliseconds)?);

        self.p_event_id.push(event_id);

        Ok(())
    }
}

pub(crate) async fn prepare(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/insert_lww_element.sql"))
        .await?;

    Ok(statement)
}

pub(crate) async fn insert(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: Batch,
) -> ::anyhow::Result<()> {
    if batch.p_value.len() > 0 {
        let statement = prepare(&transaction).await?;

        transaction
            .query(
                &statement,
                &[
                    &batch.p_value,
                    &batch.p_unix_milliseconds,
                    &batch.p_event_id,
                ],
            )
            .await?;
    }

    Ok(())
}
