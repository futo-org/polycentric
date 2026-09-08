use super::split_event_key;
use crate::service::proto::Reaction;
use entity::content_reaction;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};
use tonic::Status;

pub(super) fn add_query(
    reaction: Reaction,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let Reaction {
        event_key,
        emoji,
        positive,
    } = reaction;
    let key = split_event_key(event_key, "reaction content")?;

    let mut query = InsertStatement::new();
    query
        .into_table(content_reaction::Entity)
        .columns([
            content_reaction::Column::ContentId,
            content_reaction::Column::EventKeyCollection,
            content_reaction::Column::EventKeyIdentity,
            content_reaction::Column::EventKeyPublicKeyType,
            content_reaction::Column::EventKeyPublicKey,
            content_reaction::Column::EventKeySequence,
            content_reaction::Column::Emoji,
            content_reaction::Column::Positive,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .expr(Expr::col(content_id))
                .expr(Expr::from(key.collection))
                .expr(Expr::from(key.identity))
                .expr(Expr::from(key.public_key_type))
                .expr(Expr::from(key.public_key))
                .expr(Expr::from(key.sequence))
                .expr(Expr::from(emoji))
                .expr(Expr::from(positive));
           q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store reaction content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}
