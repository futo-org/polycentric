pub(crate) struct InputRowPointer {
    pub(crate) subject: crate::model::pointer::Pointer,
    pub(crate) from_type: Option<u64>,
}

pub(crate) struct InputRowBytes {
    pub(crate) subject: Vec<Vec<u8>>,
    pub(crate) from_type: Option<u64>,
}

pub(crate) async fn select_pointer(
    transaction: &::deadpool_postgres::Transaction<'_>,
    input_rows: Vec<InputRowPointer>,
) -> ::anyhow::Result<Vec<u64>> {
    let query = "
        SELECT
            COALESCE(SUM(count), 0)::bigint
        FROM
            count_references_pointer
        WHERE
            subject_system_key_type = $1
        AND
            subject_system_key = $2
        AND
            subject_process = $3
        AND
            subject_logical_clock = $4
        AND
            ($5 IS NULL OR from_type = $5)
    ";

    let statement = transaction.prepare_cached(query).await?;

    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_process = vec![];
    let mut p_logical_clock = vec![];
    let mut p_from_type = vec![];

    for input_row in input_rows.iter() {
        p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(input_row.subject.system()),
        )?);

        p_system_key.push(crate::model::public_key::get_key_bytes(
            input_row.subject.system(),
        ));

        p_process.push(input_row.subject.process().bytes());

        p_logical_clock
            .push(i64::try_from(*input_row.subject.logical_clock())?);

        let from_type = if let Some(x) = input_row.from_type {
            Some(i64::try_from(x)?)
        } else {
            None
        };

        p_from_type.push(from_type);
    }

    let rows = transaction
        .query(
            &statement,
            &[
                &p_system_key_type,
                &p_system_key,
                &p_process,
                &p_logical_clock,
                &p_from_type,
            ],
        )
        .await?;

    let mut result = vec![];

    for row in rows {
        let count: i64 = row.try_get(0)?;
        result.push(u64::try_from(count)?);
    }

    Ok(result)
}

pub(crate) async fn select_bytes(
    transaction: &::deadpool_postgres::Transaction<'_>,
    input_rows: &Vec<InputRowBytes>,
) -> ::anyhow::Result<Vec<u64>> {
    let query = "
        SELECT
            COALESCE(SUM(count), 0)::bigint
        FROM
            count_references_pointer
        WHERE
            subject_bytes = $1
        AND
            ($5 IS NULL OR from_type = $2)
    ";

    let statement = transaction.prepare_cached(query).await?;

    let mut p_subject = vec![];
    let mut p_from_type = vec![];

    for input_row in input_rows.iter() {
        p_subject.push(input_row.subject.clone());

        let from_type = if let Some(x) = input_row.from_type {
            Some(i64::try_from(x)?)
        } else {
            None
        };

        p_from_type.push(from_type);
    }

    let rows = transaction
        .query(&statement, &[&p_subject, &p_from_type])
        .await?;

    let mut result = vec![];

    for row in rows {
        let count: i64 = row.try_get(0)?;
        result.push(u64::try_from(count)?);
    }

    Ok(result)
}
