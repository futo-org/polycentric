use ::entity::{follow, quote, reaction, reaction_tally, reply, repost};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const REPLY_INDEX: &str = "reply_identity_post";
const QUOTE_INDEX: &str = "quote_identity_post";
const REPOST_INDEX: &str = "repost_identity_post";
const REACTION_INDEX: &str = "reaction_identity_on_post";
const FOLLOW_INDEX: &str = "follow_identity";
const REACTION_TALLY_INDEX: &str = "reaction_tally_decayed_count";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(REPLY_INDEX)
                    .table(reply::Entity)
                    .col(reply::Column::Identity)
                    .col(reply::Column::Post);
                index
            })
            .await?;

        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(QUOTE_INDEX)
                    .table(quote::Entity)
                    .col(quote::Column::Identity)
                    .col(quote::Column::Post);
                index
            })
            .await?;

        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(REPOST_INDEX)
                    .table(repost::Entity)
                    .col(repost::Column::Identity)
                    .col(repost::Column::Post);
                index
            })
            .await?;

        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(REACTION_INDEX)
                    .table(reaction::Entity)
                    .col(reaction::Column::Identity)
                    .col(reaction::Column::OnPost);
                index
            })
            .await?;

        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(FOLLOW_INDEX)
                    .table(follow::Entity)
                    .col(follow::Column::Follower)
                    .include(follow::Column::Followee);
                index
            })
            .await?;

        // Change the decayed reaction count index to include the event id.
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

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(REPLY_INDEX);
                index
            })
            .await?;

        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(QUOTE_INDEX);
                index
            })
            .await?;

        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(REPOST_INDEX);
                index
            })
            .await?;

        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(REACTION_INDEX);
                index
            })
            .await?;

        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(FOLLOW_INDEX);
                index
            })
            .await?;

        // Revert to old version.
        manager
            .drop_index({
                let mut index = Index::drop();
                index.if_exists().name(REACTION_TALLY_INDEX);
                index
            })
            .await?;
        manager.get_connection().execute_unprepared(&format!(
            "CREATE INDEX {REACTION_TALLY_INDEX} ON {0} ({1}) WHERE {1} > 0",
            reaction_tally::Entity.quoted(),
            reaction_tally::Column::DecayedCount.quoted(),
        ))
        .await?;

        Ok(())
    }
}
