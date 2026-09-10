//! Creates the `ban` table: identities banned on this server, one row
//! per identity. Columns are spelled out here (rather than derived from
//! the entity) so this migration is a fixed snapshot that never drifts
//! as `entity::ban` evolves. `IF NOT EXISTS` keeps it a no-op on a
//! database that already has the table.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Alias::new("ban"))
                    .if_not_exists()
                    // sha256 hash of the initial Identity content; matches
                    // `content_identity.identity`.
                    .col(string(Alias::new("identity")).primary_key())
                    .col(
                        timestamp_with_time_zone(Alias::new("created_at"))
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        timestamp_with_time_zone(Alias::new("updated_at"))
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    .table(Alias::new("ban"))
                    .to_owned(),
            )
            .await
    }
}
