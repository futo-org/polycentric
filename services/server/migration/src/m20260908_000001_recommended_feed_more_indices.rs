use ::entity::reaction_tally;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const REACTION_TALLY_INDEX: &str = "reaction_tally_decayed_count";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Change the index so that Postgres can use it more queries.
        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(REACTION_TALLY_INDEX);
                index
            })
            .await?;
        manager.get_connection().execute_unprepared(&format!(
            "CREATE INDEX {REACTION_TALLY_INDEX} ON {0} USING btree ({1} DESC, {2} DESC) WHERE {1} > 0",
            reaction_tally::Entity.quoted(),
            reaction_tally::Column::DecayedCount.quoted(),
            reaction_tally::Column::EventId.quoted(),
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(REACTION_TALLY_INDEX);
                index
            })
            .await?;

        manager.get_connection().execute_unprepared(&format!(
            "CREATE INDEX {REACTION_TALLY_INDEX} ON {0} ({1}) INCLUDE (event_id) WHERE {1} > 0",
            reaction_tally::Entity.quoted(),
            reaction_tally::Column::DecayedCount.quoted(),
        ))
        .await?;
        Ok(())
    }
}
