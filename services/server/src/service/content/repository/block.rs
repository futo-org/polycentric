use crate::service::proto::Block;
use entity::content_block;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};

pub(super) fn add_query(
    block: Block,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, DbErr> {
    let Block { identity } = block;
    let mut query = InsertStatement::new();
    query
        .into_table(content_block::Entity)
        .columns([
            content_block::Column::ContentId,
            content_block::Column::IdentityId,
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
