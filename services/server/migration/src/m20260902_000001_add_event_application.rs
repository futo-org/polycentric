use ::entity::{application_model, event_model};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const UNIQUE_INDEX: &str = "application_unique";
const FOREIGN_KEY: &str = "fk_events_application";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_table(application_model::Entity.unquoted())
            .await?
        {
            return Ok(());
        }

        manager
            .create_table(
                Table::create()
                    .table(application_model::Entity.unquoted())
                    .col(
                        ColumnDef::new(application_model::Column::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(application_model::Column::Name)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(application_model::Column::Identifier)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(application_model::Column::Version)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(application_model::Column::Url)
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
                    .table(application_model::Entity.unquoted())
                    .col(application_model::Column::Name)
                    .col(application_model::Column::Identifier)
                    .col(application_model::Column::Version)
                    .col(application_model::Column::Url)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(event_model::Entity)
                    .add_column(
                        ColumnDef::new(event_model::Column::ApplicationId)
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
                        event_model::Entity.unquoted(),
                        event_model::Column::ApplicationId,
                    )
                    .to(
                        application_model::Entity.unquoted(),
                        application_model::Column::Id,
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_table(application_model::Entity.unquoted())
            .await?
        {
            return Ok(());
        }

        manager
            .alter_table(
                Table::alter()
                    .table(event_model::Entity)
                    .drop_foreign_key(FOREIGN_KEY)
                    .drop_column(event_model::Column::ApplicationId)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .table(application_model::Entity.unquoted())
                    .to_owned(),
            )
            .await
    }
}
