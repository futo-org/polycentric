use ::entity::content_profile_update;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const TABLE: &str = "content_profile_update";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let mut stmt = Table::alter();
        stmt.table(content_profile_update::Entity);

        for old_column in [
            "avatar_digest_type",
            "avatar_digest_bytes",
            "banner_digest_type",
            "banner_digest_bytes",
        ] {
            if manager.has_column(TABLE, old_column).await? {
                stmt.drop_column(old_column);
            }
        }

        for new_img_column in ["avatar", "banner"] {
            if !manager.has_column(TABLE, new_img_column).await? {
                stmt.add_column(
                    ColumnDef::new(new_img_column).json_binary().null(),
                );
            }
        }

        for new_txt_column in ["description", "alias"] {
            if !manager.has_column(TABLE, new_txt_column).await? {
                stmt.add_column(ColumnDef::new(new_txt_column).text().null());
            }
        }

        manager.alter_table(stmt).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let mut stmt = Table::alter();
        stmt.table(content_profile_update::Entity);

        for new_txt_column in ["description", "alias"] {
            if manager.has_column(TABLE, new_txt_column).await? {
                stmt.drop_column(new_txt_column);
            }
        }

        for new_img_column in ["avatar", "banner"] {
            if manager.has_column(TABLE, new_img_column).await? {
                stmt.drop_column(new_img_column);
            }
        }

        for old_column in ["avatar_digest_type", "banner_digest_type"] {
            if !manager.has_column(TABLE, old_column).await? {
                stmt.add_column(
                    ColumnDef::new(old_column).small_integer().null(),
                );
            }
        }

        for old_column in ["avatar_digest_bytes", "banner_digest_bytes"] {
            if !manager.has_column(TABLE, old_column).await? {
                stmt.add_column(ColumnDef::new(old_column).binary().null());
            }
        }

        manager.alter_table(stmt).await
    }
}
