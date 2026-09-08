use ::entity::content_post;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Idempotent: checking one column is enough since all five
        // are added together.
        if manager
            .has_column("content_post", "quote_collection")
            .await?
        {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(content_post::Entity)
                    .add_column(
                        ColumnDef::new(content_post::Column::QuoteCollection)
                            .small_integer()
                            .null(),
                    )
                    .add_column(
                        ColumnDef::new(content_post::Column::QuoteIdentity)
                            .string()
                            .null(),
                    )
                    .add_column(
                        ColumnDef::new(
                            content_post::Column::QuotePublicKeyType,
                        )
                        .small_integer()
                        .null(),
                    )
                    .add_column(
                        ColumnDef::new(content_post::Column::QuotePublicKey)
                            .binary()
                            .null(),
                    )
                    .add_column(
                        ColumnDef::new(content_post::Column::QuoteSequence)
                            .big_integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("content_post", "quote_collection")
            .await?
        {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(content_post::Entity)
                    .drop_column(content_post::Column::QuoteCollection)
                    .drop_column(content_post::Column::QuoteIdentity)
                    .drop_column(content_post::Column::QuotePublicKeyType)
                    .drop_column(content_post::Column::QuotePublicKey)
                    .drop_column(content_post::Column::QuoteSequence)
                    .to_owned(),
            )
            .await
    }
}
