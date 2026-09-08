use ::entity::ban;
use sea_orm_migration::prelude::*;

/// Adds `ban.banned_by`: the identity of the moderator who issued the
/// ban. Nullable — rows created before this column (or out-of-band) have
/// no recorded banner.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("ban", "banned_by").await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(ban::Entity)
                    .add_column(ColumnDef::new(ban::Column::BannedBy).string())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("ban", "banned_by").await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(ban::Entity)
                    .drop_column(ban::Column::BannedBy)
                    .to_owned(),
            )
            .await
    }
}
