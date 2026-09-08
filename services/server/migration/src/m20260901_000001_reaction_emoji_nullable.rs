use entity::reaction;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // A reaction can be a pure up/down vote with no emoji (proto: optional).
        let mut query = TableAlterStatement::new();
        query.table(reaction::Entity).modify_column(
            ColumnDef::new_with_type(reaction::Column::Emoji, ColumnType::Text)
                .null(),
        );
        manager.alter_table(query).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let mut query = TableAlterStatement::new();
        query.table(reaction::Entity).modify_column(
            ColumnDef::new_with_type(reaction::Column::Emoji, ColumnType::Text)
                .not_null(),
        );
        manager.alter_table(query).await
    }
}
