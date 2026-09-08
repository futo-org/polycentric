use super::split_event_key;
use crate::service::proto::Delete;
use entity::content_delete;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};
use tonic::Status;

pub(super) fn add_query(
    delete: Delete,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let Delete { event_key } = delete;
    let key = split_event_key(event_key, "delete content")?;

    let mut query = InsertStatement::new();
    query
        .into_table(content_delete::Entity)
        .columns([
            content_delete::Column::ContentId,
            content_delete::Column::EventKeyCollection,
            content_delete::Column::EventKeyIdentity,
            content_delete::Column::EventKeyPublicKeyType,
            content_delete::Column::EventKeyPublicKey,
            content_delete::Column::EventKeySequence,
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
            tracing::error!(error = %err, "failed to create query to store delete content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}
