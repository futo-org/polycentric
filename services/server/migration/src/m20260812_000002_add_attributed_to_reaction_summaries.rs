//! Creates `attributed_to_reaction_summaries`: maintained per-URL reaction
//! counts (upvote/downvote) for out-of-network reactions, mirroring
//! `reaction_summaries` but keyed by URL. Derived from the entity; no-op if it
//! already exists.

use ::entity::attributed_to_reaction_summary;
use sea_orm::Schema;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_table("attributed_to_reaction_summaries")
            .await?
        {
            return Ok(());
        }
        let schema = Schema::new(manager.get_database_backend());
        manager
            .create_table(schema.create_table_from_entity(
                attributed_to_reaction_summary::Entity,
            ))
            .await?;

        for index in schema
            .create_index_from_entity(attributed_to_reaction_summary::Entity)
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
                    .table(attributed_to_reaction_summary::Entity)
                    .to_owned(),
            )
            .await
    }
}
