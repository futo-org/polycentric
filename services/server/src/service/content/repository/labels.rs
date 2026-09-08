use super::split_event_key;
use crate::service::proto::Labels;
use entity::content_label;
use sea_orm::DbErr;
use sea_orm::sea_query::{
    CommonTableExpression, DynIden, Expr, InsertStatement, SelectStatement,
    WithClause,
};
use tonic::Status;

pub(super) fn add_query(
    with: &mut WithClause,
    labels: Labels,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let Labels {
        event_key,
        label_values,
    } = labels;
    let key = split_event_key(event_key, "labels content")?;

    const LABEL_VALES: &str = "label_values";
    let mut label_values_query = SelectStatement::new();
    label_values_query.from_values(label_values, "values");
    let mut cte = CommonTableExpression::new();
    cte.table_name(LABEL_VALES).query(label_values_query);
    with.cte(cte);

    let mut query = InsertStatement::new();
    query.into_table(content_label::Entity).columns([
        content_label::Column::ContentId,
        content_label::Column::LabelValue,
        content_label::Column::EventKeyCollection,
        content_label::Column::EventKeyIdentity,
        content_label::Column::EventKeyPublicKeyType,
        content_label::Column::EventKeyPublicKey,
        content_label::Column::EventKeySequence,
    ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .from(LABEL_VALES)
                .expr(Expr::col(content_id))
                .expr(Expr::col(LABEL_VALES))
                .expr(Expr::from(key.collection))
                .expr(Expr::from(key.identity.clone()))
                .expr(Expr::from(key.public_key_type))
                .expr(Expr::from(key.public_key.clone()))
                .expr(Expr::from(key.sequence));
            q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store labels content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}
