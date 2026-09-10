use entity::default_follow_suggestion;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_table(default_follow_suggestion::Entity.unquoted())
            .await?
        {
            return Ok(());
        }

        let mut create_table = TableCreateStatement::new();
        create_table
            .table(default_follow_suggestion::Entity.unquoted())
            .col({
                let mut def =
                    ColumnDef::new(default_follow_suggestion::Column::Identity);
                def.text().primary_key().not_null();
                def
            })
            .col({
                let mut def = ColumnDef::new(
                    default_follow_suggestion::Column::CreatedAt,
                );
                def.timestamp_with_time_zone()
                    .not_null()
                    .default(Expr::current_timestamp());
                def
            });

        manager.create_table(create_table).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let mut drop_table = TableDropStatement::new();
        drop_table
            .if_exists()
            .table(default_follow_suggestion::Entity.unquoted())
            .restrict();
        manager.drop_table(drop_table).await?;
        Ok(())
    }
}
