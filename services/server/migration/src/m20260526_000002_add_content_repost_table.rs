use ::entity::content_repost;
use sea_orm::Schema;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table("content_repost").await? {
            return Ok(());
        }
        let schema = Schema::new(manager.get_database_backend());
        manager
            .create_table(
                schema.create_table_from_entity(content_repost::Entity),
            )
            .await?;

        for index in schema.create_index_from_entity(content_repost::Entity) {
            manager.create_index(index).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    .table(content_repost::Entity)
                    .to_owned(),
            )
            .await
    }
}
