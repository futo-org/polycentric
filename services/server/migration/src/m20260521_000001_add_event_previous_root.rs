use ::entity::event;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("events", "previous_root").await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(event::Entity)
                    .add_column(
                        ColumnDef::new(event::Column::PreviousRoot)
                            .binary()
                            .not_null()
                            .default(Vec::<u8>::new()),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("events", "previous_root").await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(event::Entity)
                    .drop_column(event::Column::PreviousRoot)
                    .to_owned(),
            )
            .await
    }
}
