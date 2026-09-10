use ::entity::url_info_cache;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("url_info_cache", "raw_response").await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(url_info_cache::Entity)
                    .add_column(
                        ColumnDef::new(url_info_cache::Column::RawResponse)
                            .string(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("url_info_cache", "raw_response").await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(url_info_cache::Entity)
                    .drop_column(url_info_cache::Column::RawResponse)
                    .to_owned(),
            )
            .await
    }
}
