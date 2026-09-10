use super::split_event_key;
use crate::service::proto::VerificationTarget;
use entity::content_verification_target;
use sea_orm::DbErr;
use sea_orm::sea_query::{
    CommonTableExpression, DynIden, Expr, InsertStatement, SelectStatement,
    WithClause,
};
use tonic::Status;

pub(super) fn add_query(
    with: &mut WithClause,
    target: VerificationTarget,
    content_id: (DynIden, DynIden),
) -> Result<Option<InsertStatement>, Status> {
    let VerificationTarget {
        claim_event_key,
        target_identities,
    } = target;
    let key = split_event_key(claim_event_key, "verification target")?;

    if target_identities.is_empty() {
        // SeaORM gets unhappy when we don't pass any values.
        return Ok(None);
    }

    const VERIFICATION_KEY: &str = "verification_key";
    let mut label_values_query = SelectStatement::new();
    label_values_query
        .expr_as(Expr::from(key.collection), "collection")
        .expr_as(Expr::from(key.identity), "identity")
        .expr_as(Expr::from(key.public_key_type), "public_key_type")
        .expr_as(Expr::from(key.public_key), "public_key")
        .expr_as(Expr::from(key.sequence), "sequence");
    let mut cte = CommonTableExpression::new();
    cte.table_name(VERIFICATION_KEY).query(label_values_query);
    with.cte(cte);

    const VERIFICATION_IDENTITIES: &str = "verification_identities";
    let mut label_values_query = SelectStatement::new();
    label_values_query
        .expr_as(Expr::col(("identities", "column1")), "identity")
        .from_values(target_identities, "identities");
    let mut cte = CommonTableExpression::new();
    cte.table_name(VERIFICATION_IDENTITIES)
        .query(label_values_query);
    with.cte(cte);

    let mut query = InsertStatement::new();
    query
        .into_table(content_verification_target::Entity)
        .columns([
            content_verification_target::Column::ContentId,
            content_verification_target::Column::TargetIdentity,
            content_verification_target::Column::ClaimEventKeyCollection,
            content_verification_target::Column::ClaimEventKeyIdentity,
            content_verification_target::Column::ClaimEventKeyPublicKeyType,
            content_verification_target::Column::ClaimEventKeyPublicKey,
            content_verification_target::Column::ClaimEventKeySequence,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .from(VERIFICATION_KEY)
                .from(VERIFICATION_IDENTITIES)
                .expr(Expr::col(content_id))
                .expr(Expr::col((VERIFICATION_IDENTITIES, "identity")))
                .expr(Expr::col((VERIFICATION_KEY, "collection")))
                .expr(Expr::col((VERIFICATION_KEY, "identity")))
                .expr(Expr::col((VERIFICATION_KEY, "public_key_type")))
                .expr(Expr::col((VERIFICATION_KEY, "public_key")))
                .expr(Expr::col((VERIFICATION_KEY, "sequence")));
            q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store verification target content");
            Status::internal("internal server error")
        })?;

    Ok(Some(query))
}
