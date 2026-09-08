use super::split_event_key;
use crate::service::proto::Repost;
use entity::content_repost;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};
use tonic::Status;

pub(super) fn add_query(
    repost: Repost,
    content_id: (DynIden, DynIden),
) -> Result<Option<InsertStatement>, Status> {
    let Repost { post } = repost;

    // A repost with no target is a no-op — the parent `content` row still
    // carries the serialized bytes.
    let Some(post) = post else {
        return Ok(None);
    };
    let key = split_event_key(Some(post), "repost")?;

    let mut query = InsertStatement::new();
    query
        .into_table(content_repost::Entity)
        .columns([
            content_repost::Column::ContentId,
            content_repost::Column::EventKeyCollection,
            content_repost::Column::EventKeyIdentity,
            content_repost::Column::EventKeyPublicKeyType,
            content_repost::Column::EventKeyPublicKey,
            content_repost::Column::EventKeySequence,
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
            tracing::error!(error = %err, "failed to create query to store repost content");
            Status::internal("internal server error")
        })?;

    Ok(Some(query))
}
