use crate::service::proto::Follow;
use entity::content_follow;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};

pub(super) fn add_query(
    follow: Follow,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, DbErr> {
    let Follow { identity } = follow;
    let mut query = InsertStatement::new();
    query
        .into_table(content_follow::Entity)
        .columns([
            content_follow::Column::ContentId,
            content_follow::Column::IdentityId,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .expr(Expr::col(content_id))
                .expr(Expr::from(identity));
            q
        })
        .map_err(|err| {
            DbErr::Custom(format!("incorrect amount of values: {err}"))
        })?;

    Ok(query)
}
