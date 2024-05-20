pub(crate) struct Batch {
    p_system_key_type: Vec<i64>,
    p_system_key: Vec<Vec<u8>>,
    p_process: Vec<Vec<u8>>,
    p_logical_clock: Vec<i64>,
    p_unix_milliseconds: Vec<Option<i64>>,
    p_content_type: Vec<i64>,
    p_event_id: Vec<i64>,
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
        event_id: i64,
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

        self.p_event_id.push(event_id);

        Ok(())
    }
}

pub(crate) async fn insert(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: Batch,
) -> ::anyhow::Result<()> {
    let query_insert_delete = "
        INSERT INTO deletions
        (
            system_key_type,
            system_key,
            process,
            logical_clock,
            event_id,
            unix_milliseconds,
            content_type
        )
        SELECT * FROM UNNEST (
            $1, $2, $3, $4, $5, $6, $7
        );
    ";

    let query_delete_event = "
        DELETE FROM events
        WHERE system_key_type = system_key_type
        AND system_key = system_key
        AND process = process
        AND logical_clock = logical_clock
        SELECT * FROM UNNEST (
            $1, $2, $3, $4
        ) as p (
            system_key_type,
            system_key,
            process,
            logical_clock
        )
    ";

    if batch.p_system_key_type.len() > 0 {
        ::sqlx::query(query_insert_delete)
            .bind(&batch.p_system_key_type)
            .bind(&batch.p_system_key)
            .bind(&batch.p_process)
            .bind(&batch.p_logical_clock)
            .bind(&batch.p_event_id)
            .bind(&batch.p_unix_milliseconds)
            .bind(&batch.p_content_type)
            .execute(&mut **transaction)
            .await?;

        ::sqlx::query(query_delete_event)
            .bind(batch.p_system_key_type)
            .bind(batch.p_system_key)
            .bind(batch.p_process)
            .bind(batch.p_logical_clock)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}
