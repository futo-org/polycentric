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

pub(crate) async fn insert(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: Batch,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO lww_elements 
        (
            value,
            unix_milliseconds,
            event_id
        )
        SELECT * FROM UNNEST (
            $1,
            $2,
            $3
        );
    ";

    if batch.p_value.len() > 0 {
        ::sqlx::query(query)
            .bind(batch.p_value)
            .bind(batch.p_unix_milliseconds)
            .bind(batch.p_event_id)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}
