use std::collections::HashMap;

pub(crate) enum Operation {
    Increment,
    Decrement,
}

#[derive(Eq, Hash, PartialEq)]
struct BytesKey {
    content_type: u64,
    subject_bytes: Vec<u8>,
}

pub(crate) struct BytesBatch {
    counts: HashMap<BytesKey, i64>,
}

impl BytesBatch {
    pub(crate) fn new() -> BytesBatch {
        BytesBatch {
            counts: HashMap::new(),
        }
    }

    pub(crate) fn append(
        &mut self,
        content_type: u64,
        subject_bytes: Vec<u8>,
        operation: Operation,
    ) {
        *self
            .counts
            .entry(BytesKey {
                content_type,
                subject_bytes: subject_bytes.clone(),
            })
            .or_insert(0) += match operation {
            Operation::Increment => 1,
            Operation::Decrement => -1,
        }
    }
}

pub(crate) async fn prepare_bytes(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!(
            "../sql/upsert_count_references_bytes.sql"
        ))
        .await?;

    Ok(statement)
}

pub(crate) async fn upsert_bytes(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: BytesBatch,
) -> ::anyhow::Result<()> {
    let mut p_subject_bytes = vec![];
    let mut p_content_type = vec![];
    let mut p_count = vec![];

    for (key, value) in batch.counts {
        if value != 0 {
            p_subject_bytes.push(key.subject_bytes);
            p_content_type.push(i64::try_from(key.content_type)?);
            p_count.push(value);
        }
    }

    if p_subject_bytes.len() > 0 {
        let statement = prepare_bytes(&transaction).await?;

        transaction
            .query(&statement, &[&p_subject_bytes, &p_content_type, &p_count])
            .await?;
    }

    Ok(())
}

#[derive(Eq, Hash, PartialEq)]
struct PointerKey {
    content_type: u64,
    subject: crate::model::pointer::Pointer,
}

pub(crate) struct PointerBatch {
    counts: HashMap<PointerKey, i64>,
}

impl PointerBatch {
    pub(crate) fn new() -> PointerBatch {
        PointerBatch {
            counts: HashMap::new(),
        }
    }

    pub(crate) fn append(
        &mut self,
        content_type: u64,
        subject: &crate::model::pointer::Pointer,
        operation: Operation,
    ) {
        *self
            .counts
            .entry(PointerKey {
                content_type,
                subject: subject.clone(),
            })
            .or_insert(0) += match operation {
            Operation::Increment => 1,
            Operation::Decrement => -1,
        }
    }
}

pub(crate) async fn prepare_pointer(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!(
            "../sql/upsert_count_references_pointer.sql"
        ))
        .await?;

    Ok(statement)
}

pub(crate) async fn upsert_pointer(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: PointerBatch,
) -> ::anyhow::Result<()> {
    let mut p_subject_system_key_type = vec![];
    let mut p_subject_system_key = vec![];
    let mut p_subject_process = vec![];
    let mut p_subject_logical_clock = vec![];
    let mut p_content_type = vec![];
    let mut p_count = vec![];

    for (key, value) in batch.counts {
        if value != 0 {
            p_subject_system_key_type.push(i64::try_from(
                crate::model::public_key::get_key_type(key.subject.system()),
            )?);
            p_subject_system_key.push(crate::model::public_key::get_key_bytes(
                key.subject.system(),
            ));
            p_subject_process.push(key.subject.process().bytes().clone());
            p_subject_logical_clock
                .push(i64::try_from(*key.subject.logical_clock())?);
            p_content_type.push(i64::try_from(key.content_type)?);
            p_count.push(value);
        }
    }

    if p_subject_system_key_type.len() > 0 {
        let statement = prepare_pointer(&transaction).await?;

        transaction
            .query(
                &statement,
                &[
                    &p_subject_system_key_type,
                    &p_subject_system_key,
                    &p_subject_process,
                    &p_subject_logical_clock,
                    &p_content_type,
                    &p_count,
                ],
            )
            .await?;
    }

    Ok(())
}
