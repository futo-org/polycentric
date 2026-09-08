use ::entity::ban;
use sea_orm_migration::prelude::*;

/// `ban_created_at_identity_idx`: `list_bans` pages the ban list in
/// `(created_at DESC, identity DESC)` order with a keyset predicate over
/// the same tuple. Without this index each page requires a full-table
/// sort; the composite index lets Postgres serve both the ordering (via
/// reverse scan) and the keyset seek as an index range scan.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ban_created_at_identity_idx")
                    .table(ban::Entity)
                    .col(ban::Column::CreatedAt)
                    .col(ban::Column::Identity)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("ban_created_at_identity_idx")
                    .table(ban::Entity)
                    .to_owned(),
            )
            .await
    }
}
