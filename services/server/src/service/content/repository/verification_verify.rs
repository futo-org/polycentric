use super::split_event_key;
use crate::service::proto::VerificationVerify;
use entity::content_verification_verify;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};
use tonic::Status;

pub(super) fn add_query(
    verify: VerificationVerify,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let VerificationVerify { claim_event_key } = verify;
    let key = split_event_key(claim_event_key, "verification verify")?;

    let mut query = InsertStatement::new();
    query
        .into_table(content_verification_verify::Entity)
        .columns([
            content_verification_verify::Column::ContentId,
            content_verification_verify::Column::ClaimEventKeyCollection,
            content_verification_verify::Column::ClaimEventKeyIdentity,
            content_verification_verify::Column::ClaimEventKeyPublicKeyType,
            content_verification_verify::Column::ClaimEventKeyPublicKey,
            content_verification_verify::Column::ClaimEventKeySequence,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .expr(Expr::col(content_id))
                .expr(Expr::from(key.collection))
                .expr(Expr::from(key.identity))
                .expr(Expr::from(key.public_key_type))
                .expr(Expr::from(key.public_key))
                .expr(Expr::from(key.sequence));
           q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store verification verify content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}
