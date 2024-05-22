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

pub(crate) async fn upsert_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: BytesBatch,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO count_references_bytes (
            subject_bytes,
            from_type,
            count
        )
            SELECT * FROM UNNEST (
                $1,
                $2,
                $3
            ) as p (
                subject_bytes,
                from_type,
                count
            )
            ORDER BY
                subject_bytes,
                from_type
        ON CONFLICT (
            subject_bytes,
            from_type
        )
        DO UPDATE
        SET
            count = count_references_bytes.count + EXCLUDED.count
    ";

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
        ::sqlx::query(query)
            .bind(p_subject_bytes)
            .bind(p_content_type)
            .bind(p_count)
            .execute(&mut **transaction)
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

pub(crate) async fn upsert_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: PointerBatch,
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
                from_type,
                count
            )
            ORDER BY
                subject_system_key_type,
                subject_system_key,
                subject_process,
                subject_logical_clock,
                from_type
        ON CONFLICT (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            from_type
        )
        DO UPDATE
        SET
            count = count_references_pointer.count + EXCLUDED.count
    ";

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
        ::sqlx::query(query)
            .bind(p_subject_system_key_type)
            .bind(p_subject_system_key)
            .bind(p_subject_process)
            .bind(p_subject_logical_clock)
            .bind(p_content_type)
            .bind(p_count)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}
