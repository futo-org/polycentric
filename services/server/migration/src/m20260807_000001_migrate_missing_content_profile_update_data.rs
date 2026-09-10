use ::entity::{
    content, content_blob, content_block, content_delete, content_follow,
    content_identity, content_image, content_label, content_post,
    content_profile_update, content_reaction, content_report, content_repost,
    content_verification_claim, content_verification_target,
    content_verification_verify,
};
use polycentric_common::models::protos_v2::content::ContentBody;
use polycentric_common::models::protos_v2::{Content, ImageSet};
use prost::Message;
use sea_orm::prelude::Json;
use sea_orm::{ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        let content = content::Entity::find()
            .filter(
                content::Column::Id.not_in_subquery(
                    Query::select()
                        .column(content_blob::Column::ContentId)
                        .from(content_blob::Entity)
                        .union(UnionType::All, Query::select().column(content_block::Column::ContentId).from(content_block::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_delete::Column::ContentId).from(content_delete::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_follow::Column::ContentId).from(content_follow::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_identity::Column::ContentId).from(content_identity::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_image::Column::ContentId).from(content_image::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_label::Column::ContentId).from(content_label::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_post::Column::ContentId).from(content_post::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_profile_update::Column::ContentId).from(content_profile_update::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_reaction::Column::ContentId).from(content_reaction::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_report::Column::ContentId).from(content_report::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_repost::Column::ContentId).from(content_repost::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_verification_claim::Column::ContentId).from(content_verification_claim::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_verification_target::Column::ContentId).from(content_verification_target::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_verification_verify::Column::ContentId).from(content_verification_verify::Entity).to_owned())
                        .union(UnionType::All, Query::select().column(content_block::Column::ContentId).from(content_block::Entity).to_owned())
                        .to_owned()
                )
            )
            .all(conn)
            .await?;

        let profile_updates = content.into_iter().filter_map(|row| {
            let content = Content::decode(&*row.serialized_bytes)
                .unwrap_or_else(|err| {
                    panic!("failed to decode content: {err}")
                });
            if let Some(ContentBody::ProfileUpdate(update)) =
                content.content_body
            {
                Some(content_profile_update::ActiveModel {
                    content_id: Set(row.id),
                    name: Set(update.name),
                    avatar: Set(to_json(update.avatar)),
                    banner: Set(to_json(update.banner)),
                    description: Set(update.description),
                    alias: Set(update.alias),
                })
            } else {
                None
            }
        });

        content_profile_update::Entity::insert_many(profile_updates)
            .exec(conn)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // We're only migrating data, which we don't want to undo.
        Ok(())
    }
}

// Similar to the function in `src/service/content/repository/profile_update.rs`.
fn to_json(set: Option<ImageSet>) -> Option<Json> {
    match set {
        Some(set) => match serde_json::to_value(set) {
            Ok(value) => Some(value),
            Err(err) => panic!("unexpected error: {err}"),
        },
        None => None,
    }
}
