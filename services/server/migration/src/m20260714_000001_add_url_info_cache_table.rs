use ::entity::url_info_cache;
use sea_orm::Schema;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table("url_info_cache").await? {
            return Ok(());
        }
        let schema = Schema::new(manager.get_database_backend());
        manager
            .create_table(
                schema.create_table_from_entity(url_info_cache::Entity),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_url_info_cache_updated_at")
                    .table(url_info_cache::Entity)
                    .col(url_info_cache::Column::UpdatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    .table(url_info_cache::Entity)
                    .to_owned(),
            )
            .await
    }
}
