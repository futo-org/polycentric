use ::entity::{pairing_session, pairing_session_claimer};
use sea_orm::{EntityTrait, Schema};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// Helper to create a table and its indexes from a SeaORM entity.
async fn create_entity<E: EntityTrait>(
    manager: &SchemaManager<'_>,
    schema: &Schema,
    entity: E,
) -> Result<(), DbErr> {
    manager
        .create_table(schema.create_table_from_entity(entity))
        .await?;

    for index in schema.create_index_from_entity(entity) {
        manager.create_index(index).await?;
    }

    Ok(())
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());

        create_entity(manager, &schema, pairing_session::Entity).await?;
        create_entity(manager, &schema, pairing_session_claimer::Entity)
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(pairing_session_claimer::Entity)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(pairing_session::Entity).to_owned())
            .await?;

        Ok(())
    }
}
