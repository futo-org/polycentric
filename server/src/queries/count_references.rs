pub(crate) async fn count_references_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
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

    let from_type_query = if let Some(x) = from_type {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let count = ::sqlx::query_scalar::<_, i64>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .bind(from_type_query)
        .fetch_one(&mut **transaction)
        .await?;

    Ok(u64::try_from(count)?)
}

pub(crate) async fn count_references_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    bytes: &::std::vec::Vec<::std::vec::Vec<u8>>,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
    let query = "
        SELECT
            COALESCE(SUM(count), 0)::bigint
        FROM
            count_references_bytes
        WHERE
            subject_bytes = ANY($1)
        AND
            ($2 IS NULL OR from_type = $2)
    ";

    let from_type_query = if let Some(x) = from_type {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let count = ::sqlx::query_scalar::<_, i64>(query)
        .bind(bytes)
        .bind(from_type_query)
        .fetch_one(&mut **transaction)
        .await?;

    Ok(u64::try_from(count)?)
}

pub(crate) async fn count_references(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    reference: &crate::model::PointerOrByteReferences,
    from_type: &::std::option::Option<u64>,
) -> ::anyhow::Result<u64> {
    match reference {
        crate::model::PointerOrByteReferences::Pointer(pointer) => {
            count_references_pointer(
                transaction,
                pointer.system(),
                pointer.process(),
                *pointer.logical_clock(),
                from_type,
            )
            .await
        }
        crate::model::PointerOrByteReferences::Bytes(bytes) => {
            count_references_bytes(transaction, bytes, from_type).await
        }
    }
}

#[cfg(test)]
pub mod tests {
    #[::sqlx::test]
    async fn test_no_references(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = crate::model::tests::make_test_keypair();
        let process = crate::model::tests::make_test_process();

        let system = crate::model::public_key::PublicKey::Ed25519(
            keypair.verifying_key().clone(),
        );

        let result =
            crate::queries::count_references::count_references_pointer(
                &mut transaction,
                &system,
                &process,
                5,
                &None,
            )
            .await?;

        transaction.commit().await?;

        assert!(result == 0);

        Ok(())
    }
}
