//! Indexes `lower(alias)` on `content_profile_update` so mention
//! notifications can resolve an alias to the identities claiming it with an
//! equality lookup instead of a scan. Partial: rows without an alias never
//! match, so they aren't indexed.

use ::entity::content_profile_update;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const INDEX: &str = "content_profile_update_alias_lower";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(INDEX)
                    .table(content_profile_update::Entity)
                    .col(Func::lower(Expr::col(
                        content_profile_update::Column::Alias,
                    )))
                    .and_where(
                        Expr::col(content_profile_update::Column::Alias)
                            .is_not_null(),
                    );
                index
            })
            .await
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
