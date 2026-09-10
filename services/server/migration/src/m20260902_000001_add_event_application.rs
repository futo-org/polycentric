use ::entity::{application, event};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const UNIQUE_INDEX: &str = "application_unique";
const FOREIGN_KEY: &str = "fk_events_application";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table(application::Entity.unquoted()).await? {
            return Ok(());
        }

        manager
            .create_table(
                Table::create()
                    .table(application::Entity.unquoted())
                    .col(
                        ColumnDef::new(application::Column::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(application::Column::Name)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(application::Column::Identifier)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(application::Column::Version)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(application::Column::Url)
                            .text()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name(UNIQUE_INDEX)
                    .table(application::Entity.unquoted())
                    .col(application::Column::Name)
                    .col(application::Column::Identifier)
                    .col(application::Column::Version)
                    .col(application::Column::Url)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(event::Entity)
                    .add_column(
                        ColumnDef::new(event::Column::ApplicationId)
                            .integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_foreign_key(
                ForeignKey::create()
                    .name(FOREIGN_KEY)
                    .from(
                        event::Entity.unquoted(),
                        event::Column::ApplicationId,
                    )
                    .to(application::Entity.unquoted(), application::Column::Id)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_table(application::Entity.unquoted()).await? {
            return Ok(());
        }

        manager
            .alter_table(
                Table::alter()
                    .table(event::Entity)
                    .drop_foreign_key(FOREIGN_KEY)
                    .drop_column(event::Column::ApplicationId)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .table(application::Entity.unquoted())
                    .to_owned(),
            )
            .await
    }
}
