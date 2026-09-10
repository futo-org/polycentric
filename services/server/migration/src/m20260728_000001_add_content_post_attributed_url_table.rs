//! Creates `content_post_attributed_url`: one row per URL a post is
//! attributed to (`Post.attributed_to[].link.url`), backing
//! `GetAttributionFeed`. Derived from the entity (table + indexes) like
//! the other content child tables; no-op if the table already exists.

use ::entity::content_post_attributed_url;
use sea_orm::Schema;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table("content_post_attributed_url").await? {
            return Ok(());
        }
        let schema = Schema::new(manager.get_database_backend());
        manager
            .create_table(
                schema.create_table_from_entity(
                    content_post_attributed_url::Entity,
                ),
            )
            .await?;

        for index in
            schema.create_index_from_entity(content_post_attributed_url::Entity)
        {
            manager.create_index(index).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    .table(content_post_attributed_url::Entity)
                    .to_owned(),
            )
            .await
    }
}
