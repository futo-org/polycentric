use entity::{content_post, content_profile_update};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const COLUMN: &str = "search_data";
const CONTENT_POST_INDEX: &str = "content_post_search_data";
const CONTENT_PROFILE_INDEX: &str = "content_profile_update_search_data";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();

        tx.execute_unprepared(
            "
            CREATE AGGREGATE tsvector_agg (tsvector) (
                SFUNC = pg_catalog.tsvector_concat,
                STYPE = pg_catalog.tsvector,
                INITCOND = '' -- Return an empty vector instead of NULL.
            )
        ",
        )
        .await?;

        // Function to parse hashtag separately so that we include words that
        // Postgres' English dictionary filters out by default.
        // See #281 for details.
        tx.execute_unprepared("
            CREATE FUNCTION create_tsvector(config regconfig, text TEXT, weight \"char\") RETURNS tsvector
              LANGUAGE sql IMMUTABLE PARALLEL SAFE
              CALLED ON NULL INPUT
            RETURN (
                setweight(
                    (
                        SELECT tsvector_agg(strip(to_tsvector('simple', word)))
                        FROM string_to_table(COALESCE(text, ''), ' ') as data(word)
                        WHERE starts_with(word, '#')
                    ), weight
                ) ||
                setweight(strip(to_tsvector(config, COALESCE(text, ''))), weight)
            )
        ").await?;

        let mut stmt = Table::alter();
        let stored = true;
        stmt.table(content_post::Entity)
            // NOTE: modify_column doesn't work here (SeaORM only generates a
            // query that sets `NOT NULL`).
            .drop_column(COLUMN)
            .add_column(
                ColumnDef::new(COLUMN)
                    .custom("tsvector")
                    .not_null()
                    .generated(
                        Expr::cust("create_tsvector('english', text, 'A')"),
                        stored,
                    ),
            );
        tx.execute(&stmt).await?;

        let mut index = Index::create();
        index
            .name(CONTENT_POST_INDEX)
            .table(content_post::Entity)
            .col("search_data")
            .full_text();
        manager.create_index(index).await?;

        let mut stmt = Table::alter();
        stmt.table(content_profile_update::Entity)
            // Another case where modify_column doesn't work.
            .drop_column(COLUMN)
            .add_column(
                ColumnDef::new(COLUMN)
                    .custom("tsvector")
                    .not_null()
                    .generated(
                        Expr::cust(
                            "
                        create_tsvector('simple', alias, 'A') ||
                        create_tsvector('simple', name, 'B') ||
                        create_tsvector('english', description, 'C')
                    ",
                        ),
                        stored,
                    ),
            );
        tx.execute(&stmt).await?;

        let mut index = Index::create();
        index
            .name(CONTENT_PROFILE_INDEX)
            .table(content_profile_update::Entity)
            .col("search_data")
            .full_text();
        manager.create_index(index).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();

        // Revert to the old versions.

        let mut stmt = Table::alter();
        stmt.table(content_post::Entity)
            // modify_column doesn't work here either.
            .drop_column(COLUMN)
            .add_column(ColumnDef::new(COLUMN).custom("tsvector").not_null()
                .generated(
                    Expr::cust("
                        setweight(to_tsvector('english', COALESCE(text, '')), 'A')
                    "),
                    true /* stored */)
                );
        tx.execute(&stmt).await?;

        let mut stmt = Table::alter();
        stmt.table(content_profile_update::Entity)
            // Nor here...
            .drop_column(COLUMN)
            .add_column(ColumnDef::new(COLUMN).custom("tsvector").not_null()
                .generated(
                    Expr::cust("
                        setweight(to_tsvector('simple', COALESCE(alias, '')), 'A') ||
                        setweight(to_tsvector('simple', COALESCE(name, '')), 'B') ||
                        setweight(to_tsvector('english', COALESCE(description, '')), 'C')
                    "),
                    true /* stored */)
                );
        tx.execute(&stmt).await?;

        tx.execute_unprepared("DROP FUNCTION IF EXISTS create_tsvector")
            .await?;
        tx.execute_unprepared(
            "DROP AGGREGATE IF EXISTS tsvector_agg (tsvector)",
        )
        .await?;

        let mut index = Index::create();
        index
            .name(CONTENT_POST_INDEX)
            .table(content_post::Entity)
            .col("search_data")
            .full_text();
        manager.create_index(index).await?;

        let mut index = Index::create();
        index
            .name(CONTENT_PROFILE_INDEX)
            .table(content_profile_update::Entity)
            .col("search_data")
            .full_text();
        manager.create_index(index).await?;

        Ok(())
    }
}
