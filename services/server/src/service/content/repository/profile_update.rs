use crate::service::proto::ImageSet;
use crate::service::proto::ProfileUpdate;
use entity::content_profile_update;
use sea_orm::DbErr;
use sea_orm::prelude::Json;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};
use tonic::Status;

pub(super) fn add_query(
    update: ProfileUpdate,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let ProfileUpdate {
        name,
        avatar,
        banner,
        description,
        alias,
    } = update;

    let mut query = InsertStatement::new();
    query
        .into_table(content_profile_update::Entity)
        .columns([
            content_profile_update::Column::ContentId,
            content_profile_update::Column::Name,
            content_profile_update::Column::Avatar,
            content_profile_update::Column::Banner,
            content_profile_update::Column::Description,
            content_profile_update::Column::Alias,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .expr(Expr::col(content_id))
                .expr(Expr::from(name))
                .expr(Expr::from(to_json(avatar)?))
                .expr(Expr::from(to_json(banner)?))
                .expr(Expr::from(description))
                .expr(Expr::from(alias));
           q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store profile update content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}

fn to_json(set: Option<ImageSet>) -> Result<Option<Json>, Status> {
    match set {
        Some(set) => match serde_json::to_value(set) {
            Ok(value) => Ok(Some(value)),
            Err(err) => {
                tracing::warn!(
                    "failed to serialise image set for profile update: {err}"
                );
                Err(Status::internal("internal server error"))
            }
        },
        None => Ok(None),
    }
}
