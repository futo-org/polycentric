use ::entity::{quote_model, reaction_model, reply_model, repost_model};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

// Cache rows that point at a post, looked up when the post is deleted.
#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("reaction_on_post_idx")
                    .table(reaction_model::Entity)
                    .col(reaction_model::Column::OnPost)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("repost_post_idx")
                    .table(repost_model::Entity)
                    .col(repost_model::Column::Post)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("quote_post_idx")
                    .table(quote_model::Entity)
                    .col(quote_model::Column::Post)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("reply_post_idx")
                    .table(reply_model::Entity)
                    .col(reply_model::Column::Post)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (table, name) in [
            (reaction_model::Entity.unquoted(), "reaction_on_post_idx"),
            (repost_model::Entity.unquoted(), "repost_post_idx"),
            (quote_model::Entity.unquoted(), "quote_post_idx"),
            (reply_model::Entity.unquoted(), "reply_post_idx"),
        ] {
            manager
                .drop_index(
                    Index::drop()
                        .if_exists()
                        .name(name)
                        .table(table)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}
