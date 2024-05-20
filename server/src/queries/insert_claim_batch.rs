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

pub(crate) async fn insert(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: Batch,
) -> ::anyhow::Result<()> {
    Ok(())
}
