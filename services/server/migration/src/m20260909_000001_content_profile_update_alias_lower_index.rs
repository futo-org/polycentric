//! Indexes `lower(alias)` on `content_profile_update` so mention
//! notifications can resolve an alias to the identities claiming it with an
//! equality lookup instead of a scan. Partial: rows without an alias never
//! match, so they aren't indexed.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const INDEX: &str = "content_profile_update_alias_lower";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(&format!(
                "CREATE INDEX IF NOT EXISTS {INDEX} \
                 ON content_profile_update (lower(alias)) \
                 WHERE alias IS NOT NULL"
            ))
            .await
            .map(|_| ())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(INDEX);
                index
            })
            .await
    }
}
