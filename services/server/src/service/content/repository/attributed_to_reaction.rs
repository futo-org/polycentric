use crate::service::proto::{AttributedToReaction, attributed_to::To};
use entity::content_attributed_to_reaction;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};
use tonic::Status;

pub(super) fn add_query(
    reaction: AttributedToReaction,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let AttributedToReaction {
        attributed_to,
        emoji,
        positive,
    } = reaction;
    let Some(To::Link(link)) = attributed_to.and_then(|a| a.to) else {
        return Err(Status::invalid_argument(
            "attributed_to_reaction must attribute to a link url",
        ));
    };

    let mut query = InsertStatement::new();
    query
        .into_table(content_attributed_to_reaction::Entity)
        .columns([
            content_attributed_to_reaction::Column::ContentId,
            content_attributed_to_reaction::Column::Url,
            content_attributed_to_reaction::Column::Emoji,
            content_attributed_to_reaction::Column::Positive,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .expr(Expr::col(content_id))
                .expr(Expr::from(link.url))
                .expr(Expr::from(emoji))
                .expr(Expr::from(positive));
           q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store attributed to reaction content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}
