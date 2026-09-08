use entity::{event, reaction};
use sea_orm::ColumnTrait;

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column(
                reaction::Entity.unquoted(),
                reaction::Column::Identity.unquoted(),
            )
            .await?
        {
            return Ok(());
        }

        let tx = manager.get_connection();

        // Add the reaction.identity column, allowing nulls.
        let mut query = TableAlterStatement::new();
        query.table(reaction::Entity).add_column(
            ColumnDef::new_with_type(
                reaction::Column::Identity,
                reaction::Column::Identity.def().get_column_type().clone(),
            )
            .text()
            .null(), // Set to not null once we've filled all rows.
        );
        tx.execute(&query).await?;

        // Fill the column.
        let mut query = UpdateStatement::new();
        query
            .table(reaction::Entity)
            .values([(
                reaction::Column::Identity,
                Expr::col(event::Column::Identity.as_column_ref()),
            )])
            .from(event::Entity)
            .cond_where(
                Expr::col(reaction::Column::EventId.as_column_ref())
                    .eq(Expr::col(event::Column::Id.as_column_ref())),
            );
        tx.execute(&query).await?;

        // Set column to not null.
        let mut query = TableAlterStatement::new();
        query.table(reaction::Entity).modify_column(
            ColumnDef::new_with_type(
                reaction::Column::Identity,
                reaction::Column::Identity.def().get_column_type().clone(),
            )
            .text()
            .not_null(),
        );
        tx.execute(&query).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column(
                reaction::Entity.unquoted(),
                reaction::Column::Identity.unquoted(),
            )
            .await?
        {
            return Ok(());
        }

        // Add the reaction.identity column, allowing nulls.
        let mut query = TableAlterStatement::new();
        query
            .table(reaction::Entity)
            .drop_column(reaction::Column::Identity);
        manager.alter_table(query).await?;
        Ok(())
    }
}
