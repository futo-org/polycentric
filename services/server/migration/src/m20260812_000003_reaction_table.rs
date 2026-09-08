use entity::event;
use sea_orm::ColumnTrait;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const REACTION_TABLE: &str = "reaction";
const REACTION_TALLY_TABLE: &str = "reaction_tally";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let event_id_type = event::Column::Id.def().get_column_type().clone();
        let mut reaction_table = TableCreateStatement::new();
        reaction_table
            .table(REACTION_TABLE)
            .if_not_exists()
            .col(
                // Foreign key to the event that added the reaction.
                ColumnDef::new_with_type("event_id", event_id_type.clone())
                    .primary_key()
                    .take(),
            )
            .col(
                // Foreign key to the event that created the post (that is
                // being reaction on).
                ColumnDef::new_with_type("on_post", event_id_type.clone())
                    .not_null()
                    .take(),
            )
            .col(
                ColumnDef::new_with_type("emoji", ColumnType::Text)
                    .not_null()
                    .take(),
            )
            .col(
                ColumnDef::new_with_type("positive", ColumnType::Boolean)
                    .not_null()
                    .take(),
            );
        manager.create_table(reaction_table).await?;

        let mut reaction_tally_table = TableCreateStatement::new();
        reaction_tally_table
            .table(REACTION_TALLY_TABLE)
            .if_not_exists()
            .col(
                // Foreign key to the event that created the post (for which
                // we're counting the reactions).
                ColumnDef::new_with_type("event_id", event_id_type)
                    .primary_key()
                    .not_null()
                    .take(),
            )
            .col(
                ColumnDef::new_with_type(
                    "positive_count",
                    ColumnType::BigInteger,
                )
                .not_null()
                .take(),
            )
            .col(
                ColumnDef::new_with_type(
                    "negative_count",
                    ColumnType::BigInteger,
                )
                .not_null()
                .take(),
            );
        manager.create_table(reaction_tally_table).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [REACTION_TABLE, REACTION_TALLY_TABLE] {
            manager
                .drop_table(
                    TableDropStatement::new()
                        .table(table)
                        .if_exists()
                        .restrict()
                        .take(),
                )
                .await?;
        }
        Ok(())
    }
}
