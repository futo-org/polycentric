use entity::follow;
use sea_orm::EntityName;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                TableCreateStatement::new()
                    .table(follow::Entity.table_ref())
                    .if_not_exists()
                    .col({
                        let col = follow::COLUMN.event_id;
                        ColumnDef::new_with_type(
                            col.as_column_ref().1,
                            col.def().get_column_type().clone(),
                        )
                        .primary_key()
                        .take()
                    })
                    .col({
                        let col = follow::COLUMN.follower;
                        ColumnDef::new_with_type(
                            col.as_column_ref().1,
                            col.def().get_column_type().clone(),
                        )
                        .not_null()
                        .text()
                        .take()
                    })
                    .col({
                        let col = follow::COLUMN.followee;
                        ColumnDef::new_with_type(
                            col.as_column_ref().1,
                            col.def().get_column_type().clone(),
                        )
                        .not_null()
                        .text()
                        .take()
                    })
                    .take(),
            )
            .await?;

        let index = IndexCreateStatement::new()
            .table(follow::Entity.table_ref())
            .col("follower")
            .col("followee")
            .take();

        manager.create_index(index).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                TableDropStatement::new()
                    .table(follow::Entity.table_ref())
                    .if_exists()
                    .restrict()
                    .take(),
            )
            .await
    }
}
