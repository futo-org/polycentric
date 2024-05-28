#[derive(Debug, postgres_types::ToSql, postgres_types::FromSql)]
#[postgres(name = "censorship_type")]
#[derive(::serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CensorshipType {
    #[postgres(name = "do_not_recommend")]
    DoNotRecommend,
    #[postgres(name = "refuse_storage")]
    RefuseStorage,
}

pub(crate) async fn insert_system(
    transaction: &::deadpool_postgres::Transaction<'_>,
    censor_type: CensorshipType,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO censored_systems (
            system_key_type,
            system_key,
            censorship_type
        )
        VALUES ($1, $2, $3);
    ";

    let statement = transaction.prepare_cached(query).await?;

    transaction
        .query(
            &statement,
            &[
                &i64::try_from(crate::model::public_key::get_key_type(system))?,
                &crate::model::public_key::get_key_bytes(system),
                &censor_type,
            ],
        )
        .await?;

    Ok(())
}

pub(crate) async fn insert_event(
    transaction: &::deadpool_postgres::Transaction<'_>,
    censor_type: CensorshipType,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO censored_events (
            system_key_type,
            system_key,
            process,
            logical_clock,
            censorship_type
        )
        VALUES ($1, $2, $3, $4, $5);
        ";

    let statement = transaction.prepare_cached(query).await?;

    transaction
        .query(
            &statement,
            &[
                &i64::try_from(crate::model::public_key::get_key_type(system))?,
                &crate::model::public_key::get_key_bytes(system),
                &process.bytes(),
                &i64::try_from(logical_clock)?,
                &censor_type,
            ],
        )
        .await?;

    Ok(())
}
