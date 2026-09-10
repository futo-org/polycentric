use ::entity::content_identity;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column("content_identity", "rotation_keys")
            .await?
        {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(content_identity::Entity)
                    .add_column(
                        ColumnDef::new(content_identity::Column::RotationKeys)
                            .json_binary()
                            .not_null()
                            .default(Expr::cust("'[]'::jsonb")),
                    )
                    .add_column(
                        ColumnDef::new(content_identity::Column::SigningKeys)
                            .json_binary()
                            .not_null()
                            .default(Expr::cust("'[]'::jsonb")),
                    )
                    .add_column(
                        ColumnDef::new(
                            content_identity::Column::RevocationBounds,
                        )
                        .json_binary()
                        .not_null()
                        .default(Expr::cust("'[]'::jsonb")),
                    )
                    .add_column(
                        ColumnDef::new(content_identity::Column::Servers)
                            .json_binary(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("content_identity", "rotation_keys")
            .await?
        {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(content_identity::Entity)
                    .drop_column(content_identity::Column::RotationKeys)
                    .drop_column(content_identity::Column::SigningKeys)
                    .drop_column(content_identity::Column::RevocationBounds)
                    .drop_column(content_identity::Column::Servers)
                    .to_owned(),
            )
            .await
    }
}
