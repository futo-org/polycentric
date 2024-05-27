pub(crate) struct Batch {
    p_claim_type: Vec<i64>,
    p_event_id: Vec<i64>,
    p_fields: Vec<::serde_json::Value>,
}

impl Batch {
    pub(crate) fn new() -> Batch {
        Batch {
            p_claim_type: vec![],
            p_event_id: vec![],
            p_fields: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: i64,
        claim: &crate::model::claim::Claim,
    ) -> ::anyhow::Result<()> {
        self.p_claim_type.push(i64::try_from(*claim.claim_type())?);

        self.p_fields
            .push(crate::postgres::claim_fields_to_json_object(
                claim.claim_fields(),
            ));

        self.p_event_id.push(event_id);

        Ok(())
    }
}

pub(crate) async fn prepare(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/insert_claim.sql"))
        .await?;

    Ok(statement)
}

pub(crate) async fn insert(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: Batch,
) -> ::anyhow::Result<()> {
    if batch.p_claim_type.len() > 0 {
        let statement = prepare(&transaction).await?;

        transaction
            .query(
                &statement,
                &[&batch.p_claim_type, &batch.p_event_id, &batch.p_fields],
            )
            .await?;
    }

    Ok(())
}
