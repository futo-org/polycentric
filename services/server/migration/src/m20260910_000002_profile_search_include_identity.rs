use entity::profile;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();

        let mut query = UpdateStatement::new();
        query.table(profile::Entity).values([
            // Add the identity to the search data.
            (
                "search_data",
                Expr::cust(
                    "search_data || create_tsvector('simple', identity, 'A')",
                ),
            ),
        ]);

        tx.execute(&query).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();

        let mut query = UpdateStatement::new();
        query.table(profile::Entity).values([
            // Remove the identity to the search data.
            (
                "search_data",
                Expr::cust("ts_delete(search_data, identity)"),
            ),
        ]);

        tx.execute(&query).await?;

        Ok(())
    }
}
