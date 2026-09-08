use ::entity::{quote, reaction, reply, repost};
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
                    .table(reaction::Entity)
                    .col(reaction::Column::OnPost)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("repost_post_idx")
                    .table(repost::Entity)
                    .col(repost::Column::Post)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("quote_post_idx")
                    .table(quote::Entity)
                    .col(quote::Column::Post)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("reply_post_idx")
                    .table(reply::Entity)
                    .col(reply::Column::Post)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (table, name) in [
            (reaction::Entity.unquoted(), "reaction_on_post_idx"),
            (repost::Entity.unquoted(), "repost_post_idx"),
            (quote::Entity.unquoted(), "quote_post_idx"),
            (reply::Entity.unquoted(), "reply_post_idx"),
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
