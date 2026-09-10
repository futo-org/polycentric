use super::split_event_key;
use crate::service::proto::Report;
use entity::content_report;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};
use tonic::Status;

pub(super) fn add_query(
    report: Report,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let Report {
        event_key,
        category,
        additional_info,
    } = report;
    let key = split_event_key(event_key, "report content")?;

    let mut query = InsertStatement::new();
    query
        .into_table(content_report::Entity)
        .columns([
            content_report::Column::ContentId,
            content_report::Column::Category,
            content_report::Column::AdditionalInfo,
            content_report::Column::EventKeyCollection,
            content_report::Column::EventKeyIdentity,
            content_report::Column::EventKeyPublicKeyType,
            content_report::Column::EventKeyPublicKey,
            content_report::Column::EventKeySequence,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .expr(Expr::col(content_id))
                .expr(Expr::from(category))
                .expr(Expr::from(additional_info))
                .expr(Expr::from(key.collection))
                .expr(Expr::from(key.identity))
                .expr(Expr::from(key.public_key_type))
                .expr(Expr::from(key.public_key))
                .expr(Expr::from(key.sequence));
           q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store report content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}
