//! Creates `content_attributed_to_reaction`: one row per out-of-network
//! reaction (`AttributedToReaction`) to a URL (e.g. a video like/dislike), so
//! per-URL reaction counts can be maintained. Derived from the entity (table +
//! indexes) like the other content child tables; no-op if it already exists.

use ::entity::content_attributed_to_reaction;
use sea_orm::Schema;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table("content_attributed_to_reaction").await? {
            return Ok(());
        }
        let schema = Schema::new(manager.get_database_backend());
        manager
            .create_table(schema.create_table_from_entity(
                content_attributed_to_reaction::Entity,
            ))
            .await?;

        for index in schema
            .create_index_from_entity(content_attributed_to_reaction::Entity)
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
                    .table(content_attributed_to_reaction::Entity)
                    .to_owned(),
            )
            .await
    }
}
