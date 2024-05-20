pub(crate) struct PointerBatch {
    p_subject_system_key_type: Vec<i64>,
    p_subject_system_key: Vec<Vec<u8>>,
    p_subject_process: Vec<Vec<u8>>,
    p_subject_logical_clock: Vec<i64>,
    p_link_content_type: Vec<i64>,
    p_event_id: Vec<i64>,
}

impl PointerBatch {
    pub(crate) fn new() -> PointerBatch {
        PointerBatch {
            p_subject_system_key_type: vec![],
            p_subject_system_key: vec![],
            p_subject_process: vec![],
            p_subject_logical_clock: vec![],
            p_link_content_type: vec![],
            p_event_id: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: i64,
        link_content_type: u64,
        pointer: &crate::model::pointer::Pointer,
    ) -> ::anyhow::Result<()> {
        self.p_subject_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(pointer.system()),
        )?);

        self.p_subject_system_key
            .push(crate::model::public_key::get_key_bytes(pointer.system()));

        self.p_subject_process
            .push(pointer.process().bytes().to_vec());

        self.p_subject_logical_clock
            .push(i64::try_from(*pointer.logical_clock())?);

        self.p_link_content_type
            .push(i64::try_from(link_content_type)?);

        self.p_event_id.push(event_id);

        Ok(())
    }
}

pub(crate) async fn insert_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: PointerBatch,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO event_links
        (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            link_content_type,
            event_id
        )
        SELECT * FROM UNNEST (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
        ) as p (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            link_content_type,
            event_id
        )
    ";

    if batch.p_subject_system_key_type.len() == 0 {
        return Ok(());
    }

    ::sqlx::query(query)
        .bind(batch.p_subject_system_key_type)
        .bind(batch.p_subject_system_key)
        .bind(batch.p_subject_process)
        .bind(batch.p_subject_logical_clock)
        .bind(batch.p_link_content_type)
        .bind(batch.p_event_id)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) struct BytesBatch {
    p_subject_bytes: Vec<Vec<u8>>,
    p_event_id: Vec<i64>,
}

impl BytesBatch {
    pub(crate) fn new() -> BytesBatch {
        BytesBatch {
            p_subject_bytes: vec![],
            p_event_id: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: i64,
        subject_bytes: Vec<u8>,
    ) -> ::anyhow::Result<()> {
        self.p_subject_bytes.push(subject_bytes);

        self.p_event_id.push(event_id);

        Ok(())
    }
}

pub(crate) async fn insert_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: BytesBatch,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO event_references_bytes
        (
            subject_bytes,
            event_id
        )
        SELECT * FROM UNNEST (
            $1,
            $2,
        ) as p (
            subject_bytes,
            event_id
        )
    ";

    if batch.p_subject_bytes.len() == 0 {
        return Ok(());
    }

    ::sqlx::query(query)
        .bind(batch.p_subject_bytes)
        .bind(batch.p_event_id)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}
