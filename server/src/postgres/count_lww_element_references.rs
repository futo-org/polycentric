pub(crate) async fn count_lww_element_references_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    process: &polycentric_protocol::model::process::Process,
    logical_clock: u64,
    value: &::std::vec::Vec<u8>,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
    let query = "
        SELECT
            COALESCE(SUM(count), 0)::bigint
        FROM
            count_lww_element_references_pointer
        WHERE
            subject_system_key_type = $1
        AND
            subject_system_key = $2
        AND
            subject_process = $3
        AND
            subject_logical_clock = $4
        AND
            value = $5
        AND
            ($6 IS NULL OR from_type = $6)
    ";

    let from_type_query = if let Some(x) = from_type {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let count = ::sqlx::query_scalar::<_, i64>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .bind(value)
        .bind(from_type_query)
        .fetch_one(&mut **transaction)
        .await?;

    Ok(u64::try_from(count)?)
}

pub(crate) async fn count_lww_element_references_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    bytes: &::std::vec::Vec<::std::vec::Vec<u8>>,
    value: &::std::vec::Vec<u8>,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
    let query = "
        SELECT
            COALESCE(SUM(count), 0)::bigint
        FROM
            count_lww_element_references_bytes
        WHERE
            subject_bytes = ANY($1)
        AND
            value = $2
        AND
            ($3 IS NULL OR from_type = $3)
    ";

    let from_type_query = if let Some(x) = from_type {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let count = ::sqlx::query_scalar::<_, i64>(query)
        .bind(bytes)
        .bind(value)
        .bind(from_type_query)
        .fetch_one(&mut **transaction)
        .await?;

    Ok(u64::try_from(count)?)
}

pub(crate) async fn count_lww_element_references(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    reference: &polycentric_protocol::model::PointerOrByteReferences,
    value: &::std::vec::Vec<u8>,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
    match reference {
        polycentric_protocol::model::PointerOrByteReferences::Pointer(
            pointer,
        ) => {
            count_lww_element_references_pointer(
                transaction,
                pointer.system(),
                pointer.process(),
                *pointer.logical_clock(),
                value,
                from_type,
            )
            .await
        }
        polycentric_protocol::model::PointerOrByteReferences::Bytes(bytes) => {
            count_lww_element_references_bytes(
                transaction,
                bytes,
                value,
                from_type,
            )
            .await
        }
    }
}

#[cfg(test)]
pub mod tests {
    #[::sqlx::test]
    async fn test_no_references(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = polycentric_protocol::model::tests::make_test_keypair();
        let process = polycentric_protocol::model::tests::make_test_process();

        let system =
            polycentric_protocol::model::public_key::PublicKey::Ed25519(
                keypair.verifying_key().clone(),
            );

        let result = crate::postgres::count_lww_element_references::
            count_lww_element_references_pointer(
                &mut transaction,
                &system,
                &process,
                5,
                &vec![],
                &None,
            ).await?;

        transaction.commit().await?;

        assert!(result == 0);

        Ok(())
    }
}
