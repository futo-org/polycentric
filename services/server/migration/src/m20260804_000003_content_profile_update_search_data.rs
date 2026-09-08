use ::entity::content_profile_update;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const TABLE: &str = "content_profile_update";
const COLUMN: &str = "search_data";
const INDEX: &str = "content_profile_update_search_data";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, COLUMN).await? {
            let mut stmt = Table::alter();
            stmt.table(content_profile_update::Entity)
                .add_column(ColumnDef::new(COLUMN).custom("tsvector").not_null()
                    .generated(
                        Expr::cust("
                            setweight(to_tsvector('simple', COALESCE(alias, '')), 'A') ||
                            setweight(to_tsvector('simple', COALESCE(name, '')), 'B') ||
                            setweight(to_tsvector('english', COALESCE(description, '')), 'C')
                        "),
                        true /* stored */)
                    );
            manager.alter_table(stmt).await?;
        }

        if !manager.has_index(TABLE, INDEX).await? {
            let mut index = Index::create();
            index
                .name(INDEX)
                .table(TABLE)
                .col("search_data")
                .full_text();
            manager.create_index(index).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(TABLE, COLUMN).await? {
            let mut stmt = Table::alter();
            stmt.table(content_profile_update::Entity)
                .drop_column(COLUMN);
            manager.alter_table(stmt).await?;
        }

        if manager.has_index(TABLE, INDEX).await? {
            let mut index = Index::drop();
            index.name(INDEX).table(TABLE);
            manager.drop_index(index).await?;
        }

        Ok(())
    }
}
