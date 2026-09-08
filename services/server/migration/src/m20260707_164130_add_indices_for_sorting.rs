use ::entity::{event, notification};
use sea_orm_migration::prelude::*;

/// `notification_to_identity_id_idx`: `list_notifications` grabs the notifications
/// for an identity reverse sorted by the primary key.
///
/// `events_collection_created_at_id_idx`: feeds are sorted in reverse-chronological
/// order, with the primary key as a fallback to keep the sort order stable.
///
/// `events_identity_heads_idx`: `list_heads` gets only the head for each "event stream"
/// for efficient syncing.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("notification_to_identity_id_idx")
                    .table(notification::Entity)
                    .col(notification::Column::ToIdentity)
                    .col(notification::Column::Id)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("events_collection_created_at_id_idx")
                    .table(event::Entity)
                    .col(event::Column::Collection)
                    .col(event::Column::CreatedAt)
                    .col(event::Column::Id)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("events_identity_heads_idx")
                    .table(event::Entity)
                    .col(event::Column::Identity)
                    .col(event::Column::PublicKeyType)
                    .col(event::Column::PublicKey)
                    .col(event::Column::Collection)
                    .col(event::Column::Sequence)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("events_identity_heads_idx")
                    .table(event::Entity)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("events_collection_created_at_id_idx")
                    .table(event::Entity)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("notification_to_identity_id_idx")
                    .table(notification::Entity)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}
