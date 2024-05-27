use ::std::collections::HashMap;

pub(crate) struct BytesBatch {
    p_event_id: Vec<i64>,
    p_system_key_type: Vec<i64>,
    p_system_key: Vec<Vec<u8>>,
    p_process: Vec<Vec<u8>>,
    p_content_type: Vec<i64>,
    p_lww_element_unix_milliseconds: Vec<i64>,
    p_subject: Vec<Vec<u8>>,
}

impl BytesBatch {
    pub(crate) fn new() -> BytesBatch {
        BytesBatch {
            p_event_id: vec![],
            p_system_key_type: vec![],
            p_system_key: vec![],
            p_process: vec![],
            p_content_type: vec![],
            p_lww_element_unix_milliseconds: vec![],
            p_subject: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: i64,
        event_pointer: &crate::model::InsecurePointer,
        content_type: u64,
        lww_element: &crate::protocol::LWWElement,
        subject: &Vec<u8>,
    ) -> ::anyhow::Result<()> {
        self.p_event_id.push(event_id);

        self.p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(event_pointer.system()),
        )?);

        self.p_system_key
            .push(crate::model::public_key::get_key_bytes(
                event_pointer.system(),
            ));

        self.p_process
            .push(event_pointer.process().bytes().to_vec());

        self.p_content_type.push(i64::try_from(content_type)?);

        self.p_lww_element_unix_milliseconds
            .push(i64::try_from(lww_element.unix_milliseconds)?);

        self.p_subject.push(subject.clone());

        Ok(())
    }
}

pub(crate) struct PointerBatch {
    p_event_id: Vec<i64>,
    p_system_key_type: Vec<i64>,
    p_system_key: Vec<Vec<u8>>,
    p_process: Vec<Vec<u8>>,
    p_content_type: Vec<i64>,
    p_lww_element_unix_milliseconds: Vec<i64>,
    p_subject_system_key_type: Vec<i64>,
    p_subject_system_key: Vec<Vec<u8>>,
    p_subject_process: Vec<Vec<u8>>,
    p_subject_logical_clock: Vec<i64>,
}

impl PointerBatch {
    pub(crate) fn new() -> PointerBatch {
        PointerBatch {
            p_event_id: vec![],
            p_system_key_type: vec![],
            p_system_key: vec![],
            p_process: vec![],
            p_content_type: vec![],
            p_lww_element_unix_milliseconds: vec![],
            p_subject_system_key_type: vec![],
            p_subject_system_key: vec![],
            p_subject_process: vec![],
            p_subject_logical_clock: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: i64,
        event_pointer: &crate::model::InsecurePointer,
        content_type: u64,
        lww_element: &crate::protocol::LWWElement,
        subject: &crate::model::pointer::Pointer,
    ) -> ::anyhow::Result<()> {
        self.p_event_id.push(event_id);

        self.p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(event_pointer.system()),
        )?);

        self.p_system_key
            .push(crate::model::public_key::get_key_bytes(
                event_pointer.system(),
            ));

        self.p_process
            .push(event_pointer.process().bytes().to_vec());

        self.p_content_type.push(i64::try_from(content_type)?);

        self.p_lww_element_unix_milliseconds
            .push(i64::try_from(lww_element.unix_milliseconds)?);

        self.p_subject_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(subject.system()),
        )?);

        self.p_subject_system_key
            .push(crate::model::public_key::get_key_bytes(subject.system()));

        self.p_subject_process
            .push(subject.process().bytes().to_vec());

        self.p_subject_logical_clock
            .push(i64::try_from(*subject.logical_clock())?);

        Ok(())
    }
}

pub(crate) async fn upsert_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: BytesBatch,
) -> ::anyhow::Result<
    HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
> {
    let query_old = "
        SELECT
            '\\xDEADBEEF'::bytea
        FROM
            lww_element_latest_reference_bytes
        INNER JOIN (
            SELECT
                *
            FROM UNNEST (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7
            ) as p (
                event_id,
                system_key_type,
                system_key,
                process,
                content_type,
                lww_element_unix_milliseconds,
                subject
            )
        ) as p
        ON
            lww_element_latest_reference_bytes.system_key_type = p.system_key_type
        AND
            lww_element_latest_reference_bytes.system_key = p.system_key
        AND
            lww_element_latest_reference_bytes.content_type = p.content_type
        AND
            lww_element_latest_reference_bytes.subject = p.subject
        WHERE
            (
                p.lww_element_unix_milliseconds,
                p.process
            )
            >
            (
                lww_element_latest_reference_bytes.lww_element_unix_milliseconds,
                lww_element_latest_reference_bytes.process
            )
        ORDER BY
            lww_element_latest_reference_bytes.system_key_type,
            lww_element_latest_reference_bytes.system_key,
            lww_element_latest_reference_bytes.content_type,
            lww_element_latest_reference_bytes.subject,
            lww_element_latest_reference_bytes.lww_element_unix_milliseconds DESC
        FOR UPDATE;
    ";

    let query = "
        INSERT INTO lww_element_latest_reference_bytes (
            event_id,
            system_key_type,
            system_key,
            process,
            content_type,
            lww_element_unix_milliseconds,
            subject
        )
            SELECT DISTINCT ON (
                system_key_type,
                system_key,
                content_type,
                subject
            ) * FROM UNNEST (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7
            ) as p (
                event_id,
                system_key_type,
                system_key,
                process,
                content_type,
                lww_element_unix_milliseconds,
                subject
            )
            ORDER BY
                system_key_type,
                system_key,
                content_type,
                subject,
                lww_element_unix_milliseconds DESC
        ON CONFLICT (
            system_key_type,
            system_key,
            content_type,
            subject
        )
        DO UPDATE
        SET
            event_id = EXCLUDED.event_id,
            process = EXCLUDED.process,
            lww_element_unix_milliseconds = EXCLUDED.lww_element_unix_milliseconds
        WHERE
            (
                EXCLUDED.lww_element_unix_milliseconds,
                EXCLUDED.process
            )
            >
            (
                lww_element_latest_reference_bytes.lww_element_unix_milliseconds,
                lww_element_latest_reference_bytes.process
            );
    ";

    let mut result = HashMap::new();

    if batch.p_event_id.len() > 0 {
        let updated_rows =
            ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query_old)
                .bind(&batch.p_event_id)
                .bind(&batch.p_system_key_type)
                .bind(&batch.p_system_key)
                .bind(&batch.p_process)
                .bind(&batch.p_content_type)
                .bind(&batch.p_lww_element_unix_milliseconds)
                .bind(&batch.p_subject)
                .fetch_all(&mut **transaction)
                .await?;

        ::sqlx::query(query)
            .bind(batch.p_event_id)
            .bind(batch.p_system_key_type)
            .bind(batch.p_system_key)
            .bind(batch.p_process)
            .bind(batch.p_content_type)
            .bind(batch.p_lww_element_unix_milliseconds)
            .bind(batch.p_subject)
            .execute(&mut **transaction)
            .await?;

        /*
        for raw_event in updated_rows {
            let layers = crate::model::EventLayers::new(
                crate::model::signed_event::from_vec(&raw_event)?,
            )?;

            result.insert(
                crate::model::InsecurePointer::from_event(layers.event()),
                layers,
            );
        }
        */
    }

    Ok(result)
}

pub(crate) async fn upsert_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: PointerBatch,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO lww_element_latest_reference_pointer (
            event_id,
            system_key_type,
            system_key,
            process,
            content_type,
            lww_element_unix_milliseconds,
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock
        )
            SELECT DISTINCT ON (
                system_key_type,
                system_key,
                content_type,
                subject_system_key_type,
                subject_system_key,
                subject_process,
                subject_logical_clock
            ) * FROM UNNEST (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10
            ) as p (
                event_id,
                system_key_type,
                system_key,
                process,
                content_type,
                lww_element_unix_milliseconds,
                subject_system_key_type,
                subject_system_key,
                subject_process,
                subject_logical_clock
            )
            ORDER BY
                system_key_type,
                system_key,
                content_type,
                subject_system_key_type,
                subject_system_key,
                subject_process,
                subject_logical_clock,
                lww_element_unix_milliseconds DESC
        ON CONFLICT (
            system_key_type,
            system_key,
            content_type,
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock
        )
        DO UPDATE
        SET
            event_id = EXCLUDED.event_id,
            process = EXCLUDED.process,
            lww_element_unix_milliseconds = EXCLUDED.lww_element_unix_milliseconds
        WHERE
            (
                EXCLUDED.lww_element_unix_milliseconds,
                EXCLUDED.process
            )
            >
            (
                lww_element_latest_reference_pointer.lww_element_unix_milliseconds,
                lww_element_latest_reference_pointer.process
            );
    ";

    if batch.p_event_id.len() > 0 {
        ::sqlx::query(query)
            .bind(batch.p_event_id)
            .bind(batch.p_system_key_type)
            .bind(batch.p_system_key)
            .bind(batch.p_process)
            .bind(batch.p_content_type)
            .bind(batch.p_lww_element_unix_milliseconds)
            .bind(batch.p_subject_system_key_type)
            .bind(batch.p_subject_system_key)
            .bind(batch.p_subject_process)
            .bind(batch.p_subject_logical_clock)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}
