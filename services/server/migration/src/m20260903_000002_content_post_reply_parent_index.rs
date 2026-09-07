use ::entity::content_post_model;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const INDEX: &str = "content_post_reply_parent";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(INDEX)
                    .table(content_post_model::Entity)
                    .col(content_post_model::Column::ReplyParentCollection)
                    .col(content_post_model::Column::ReplyParentIdentity)
                    .col(content_post_model::Column::ReplyParentPublicKeyType)
                    .col(content_post_model::Column::ReplyParentPublicKey)
                    .col(content_post_model::Column::ReplyParentSequence);
                index
            })
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(INDEX);
                index
            })
            .await
    }
}
