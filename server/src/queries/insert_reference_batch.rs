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

pub(crate) async fn prepare_pointer(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!(
            "../sql/insert_reference_pointer.sql"
        ))
        .await?;

    Ok(statement)
}

pub(crate) async fn insert_pointer(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: PointerBatch,
) -> ::anyhow::Result<()> {
    if batch.p_subject_system_key_type.len() == 0 {
        return Ok(());
    }

    let statement = prepare_pointer(&transaction).await?;

    transaction
        .query(
            &statement,
            &[
                &batch.p_subject_system_key_type,
                &batch.p_subject_system_key,
                &batch.p_subject_process,
                &batch.p_subject_logical_clock,
                &batch.p_link_content_type,
                &batch.p_event_id,
            ],
        )
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

pub(crate) async fn prepare_bytes(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!(
            "../sql/insert_reference_bytes.sql"
        ))
        .await?;

    Ok(statement)
}

pub(crate) async fn insert_bytes(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: BytesBatch,
) -> ::anyhow::Result<()> {
    if batch.p_subject_bytes.len() == 0 {
        return Ok(());
    }

    let statement = prepare_bytes(&transaction).await?;

    transaction
        .query(&statement, &[&batch.p_subject_bytes, &batch.p_event_id])
        .await?;

    Ok(())
}
