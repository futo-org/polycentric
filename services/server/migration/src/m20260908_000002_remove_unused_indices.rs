//! Remove indices that are unused on production.

use ::entity::{
    content_attributed_to_reaction_model, content_post_attributed_url_model,
};
use sea_orm::Schema;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Never used, uses 596 MB for the index, while the table is 622 MB.
        manager
            .drop_index({
                let mut index = Index::drop();
                index.name("idx-content_attributed_to_reaction-url");
                index
            })
            .await?;

        // Never used, uses 21 MB for the index, 26 MB for the table.
        manager
            .drop_index({
                let mut index = Index::drop();
                index.name("idx-content_post_attributed_url-url");
                index
            })
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());
        for index in schema.create_index_from_entity(
            content_attributed_to_reaction_model::Entity,
        ) {
            manager.create_index(index).await?;
        }
        for index in schema
            .create_index_from_entity(content_post_attributed_url_model::Entity)
        {
            manager.create_index(index).await?;
        }

        Ok(())
    }
}
