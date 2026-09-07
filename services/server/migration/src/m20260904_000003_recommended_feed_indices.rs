use ::entity::{
    follow_model, quote_model, reaction_model, reaction_tally_model,
    reply_model, repost_model,
};
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
                    .table(reply_model::Entity)
                    .col(reply_model::Column::Identity)
                    .col(reply_model::Column::Post);
                index
            })
            .await?;

        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(QUOTE_INDEX)
                    .table(quote_model::Entity)
                    .col(quote_model::Column::Identity)
                    .col(quote_model::Column::Post);
                index
            })
            .await?;

        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(REPOST_INDEX)
                    .table(repost_model::Entity)
                    .col(repost_model::Column::Identity)
                    .col(repost_model::Column::Post);
                index
            })
            .await?;

        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(REACTION_INDEX)
                    .table(reaction_model::Entity)
                    .col(reaction_model::Column::Identity)
                    .col(reaction_model::Column::OnPost);
                index
            })
            .await?;

        manager
            .create_index({
                let mut index = Index::create();
                index
                    .if_not_exists()
                    .name(FOLLOW_INDEX)
                    .table(follow_model::Entity)
                    .col(follow_model::Column::Follower)
                    .include(follow_model::Column::Followee);
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
            reaction_tally_model::Entity.quoted(),
            reaction_tally_model::Column::DecayedCount.quoted(),
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
            reaction_tally_model::Entity.quoted(),
            reaction_tally_model::Column::DecayedCount.quoted(),
        ))
        .await?;

        Ok(())
    }
}
