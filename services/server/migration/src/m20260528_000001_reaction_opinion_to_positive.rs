use ::entity::content_reaction;
use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::ConnectionTrait;

/// Replaces `content_reaction.opinion` (the legacy 0/1/2/3 enum-in-an-int)
/// with `positive: bool`, matching the v2 `Reaction.positive` proto field.
/// Existing data is dropped — no backfill.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // On a fresh database `content_reaction` is created from the current
        // entity, which already has `positive` and never had `opinion`, so
        // guard each step to keep this a no-op there while still migrating
        // older databases that still carry the legacy column.
        if manager.has_column("content_reaction", "opinion").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(content_reaction::Entity)
                        .drop_column(Alias::new("opinion"))
                        .to_owned(),
                )
                .await?;
        }

        if !manager.has_column("content_reaction", "positive").await? {
            // Existing reactions can't be backfilled (the legacy `opinion`
            // values are intentionally not mapped to `positive`), so drop them
            // before adding the NOT NULL column — otherwise existing rows would
            // get NULL and the ALTER fails.
            manager
                .get_connection()
                .execute_unprepared("DELETE FROM content_reaction")
                .await?;

            manager
                .alter_table(
                    Table::alter()
                        .table(content_reaction::Entity)
                        .add_column(
                            ColumnDef::new(content_reaction::Column::Positive)
                                .boolean()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("content_reaction", "positive").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(content_reaction::Entity)
                        .drop_column(content_reaction::Column::Positive)
                        .to_owned(),
                )
                .await?;
        }

        if !manager.has_column("content_reaction", "opinion").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(content_reaction::Entity)
                        .add_column(
                            ColumnDef::new(Alias::new("opinion"))
                                .small_integer()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        Ok(())
    }
}
