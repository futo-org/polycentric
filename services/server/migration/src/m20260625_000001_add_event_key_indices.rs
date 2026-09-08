use ::entity::{content_delete, content_label, content_reaction};
use sea_orm_migration::prelude::*;

/// `content_delete`, `content_reaction`, and `content_label` are all
/// queried to match events, but have no index over the `event_key_*`
/// columns (see `tombstone::list_tombstones_for_event_keys`). We add
/// an index so that matching events does not require a sequential scan.
///
/// Each index mirrors the column order of the existing
/// `idx-events-event_key` unique index on the `events` table
/// (collection, identity, public_key_type, public_key, sequence) but is
/// **non-unique** because a single target event can have multiple
/// delete / reaction / label rows.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("content_delete_event_key_idx")
                    .table(content_delete::Entity)
                    .col(content_delete::Column::EventKeyCollection)
                    .col(content_delete::Column::EventKeyIdentity)
                    .col(content_delete::Column::EventKeyPublicKeyType)
                    .col(content_delete::Column::EventKeyPublicKey)
                    .col(content_delete::Column::EventKeySequence)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("content_reaction_event_key_idx")
                    .table(content_reaction::Entity)
                    .col(content_reaction::Column::EventKeyCollection)
                    .col(content_reaction::Column::EventKeyIdentity)
                    .col(content_reaction::Column::EventKeyPublicKeyType)
                    .col(content_reaction::Column::EventKeyPublicKey)
                    .col(content_reaction::Column::EventKeySequence)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("content_label_event_key_idx")
                    .table(content_label::Entity)
                    .col(content_label::Column::EventKeyCollection)
                    .col(content_label::Column::EventKeyIdentity)
                    .col(content_label::Column::EventKeyPublicKeyType)
                    .col(content_label::Column::EventKeyPublicKey)
                    .col(content_label::Column::EventKeySequence)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("content_label_event_key_idx")
                    .table(content_label::Entity)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("content_reaction_event_key_idx")
                    .table(content_reaction::Entity)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("content_delete_event_key_idx")
                    .table(content_delete::Entity)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}
