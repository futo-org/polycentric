use entity::{block, content, content_block, content_delete, event};
use polycentric_common::models::collections;
use sea_orm::sea_query::{IntoCondition, SelectStatement};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityName, EntityTrait, RelationDef,
};
use sea_orm_migration::prelude::*;

const GRAPH_COLLECTION: i16 = collections::SOCIAL_GRAPH as i16;
const DELETE_CONTENT_ALIAS: &str = "delete_content";
const DELETE_EVENT_ALIAS: &str = "delete_event";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                TableCreateStatement::new()
                    .table(block::Entity.table_ref())
                    .if_not_exists()
                    .col({
                        let col = block::COLUMN.event_id;
                        ColumnDef::new_with_type(
                            col.as_column_ref().1,
                            col.def().get_column_type().clone(),
                        )
                        .primary_key()
                        .take()
                    })
                    .col({
                        let col = block::COLUMN.blocker;
                        ColumnDef::new_with_type(
                            col.as_column_ref().1,
                            col.def().get_column_type().clone(),
                        )
                        .not_null()
                        .text()
                        .take()
                    })
                    .col({
                        let col = block::COLUMN.blocked;
                        ColumnDef::new_with_type(
                            col.as_column_ref().1,
                            col.def().get_column_type().clone(),
                        )
                        .not_null()
                        .text()
                        .take()
                    })
                    .take(),
            )
            .await?;

        let index = IndexCreateStatement::new()
            .table(block::Entity.table_ref())
            .col("blocker")
            .col("blocked")
            .take();

        manager.create_index(index).await?;

        manager.get_connection().execute(&backfill()?).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                TableDropStatement::new()
                    .table(block::Entity.table_ref())
                    .if_exists()
                    .restrict()
                    .take(),
            )
            .await
    }
}

/// Backfill the block state from block events. The block cache is the source
/// of truth for block state for feed requests, so it must be up-to-date.
fn backfill() -> Result<InsertStatement, DbErr> {
    let mut blocks = SelectStatement::new();
    blocks
        .column(event::Column::Id.as_column_ref())
        .column(event::Column::Identity.as_column_ref())
        .column(content_block::Column::IdentityId.as_column_ref())
        .from(event::Entity)
        .inner_join(content::Entity, content_join())
        .inner_join(
            content_block::Entity,
            Expr::col(content_block::Column::ContentId.as_column_ref())
                .eq(Expr::col(content::Column::Id.as_column_ref())),
        )
        .and_where(event::Column::Collection.eq(GRAPH_COLLECTION))
        .and_where(Expr::not_exists(deletions_of_the_event()));

    let mut insert = InsertStatement::new();
    insert
        .into_table(block::Entity)
        .columns([
            block::Column::EventId,
            block::Column::Blocker,
            block::Column::Blocked,
        ])
        .select_from(blocks)
        .map_err(|err| {
            DbErr::Custom(format!("incorrect amount of values: {err}"))
        })?
        .on_conflict({
            let mut conflict = OnConflict::column(block::Column::EventId);
            conflict.do_nothing();
            conflict
        });

    Ok(insert)
}

/// Subquery: the deletion events that tombstone the graph event of the outer
/// query.
fn deletions_of_the_event() -> SelectStatement {
    let mut deletions = SelectStatement::new();
    deletions
        .expr(Expr::val(1))
        .from(content_delete::Entity)
        .inner_join(
            TableRef::from(content::Entity).alias(DELETE_CONTENT_ALIAS),
            Expr::col((DELETE_CONTENT_ALIAS, content::Column::Id)).eq(
                Expr::col(content_delete::Column::ContentId.as_column_ref()),
            ),
        )
        .inner_join(
            TableRef::from(event::Entity).alias(DELETE_EVENT_ALIAS),
            Condition::all()
                .add(
                    Expr::col((
                        DELETE_EVENT_ALIAS,
                        event::Column::ContentDigestType,
                    ))
                    .eq(Expr::col((
                        DELETE_CONTENT_ALIAS,
                        content::Column::DigestType,
                    ))),
                )
                .add(
                    Expr::col((
                        DELETE_EVENT_ALIAS,
                        event::Column::ContentDigestBytes,
                    ))
                    .eq(Expr::col((
                        DELETE_CONTENT_ALIAS,
                        content::Column::DigestBytes,
                    ))),
                )
                // Only the author of an event may delete it.
                .add(
                    Expr::col((DELETE_EVENT_ALIAS, event::Column::Identity))
                        .eq(Expr::col(
                            content_delete::Column::EventKeyIdentity
                                .as_column_ref(),
                        )),
                ),
        );

    // Correlate with the outer query
    for (delete_key, event_key) in [
        (
            content_delete::Column::EventKeyCollection.as_column_ref(),
            event::Column::Collection.as_column_ref(),
        ),
        (
            content_delete::Column::EventKeyIdentity.as_column_ref(),
            event::Column::Identity.as_column_ref(),
        ),
        (
            content_delete::Column::EventKeyPublicKeyType.as_column_ref(),
            event::Column::PublicKeyType.as_column_ref(),
        ),
        (
            content_delete::Column::EventKeyPublicKey.as_column_ref(),
            event::Column::PublicKey.as_column_ref(),
        ),
        (
            content_delete::Column::EventKeySequence.as_column_ref(),
            event::Column::Sequence.as_column_ref(),
        ),
    ] {
        deletions.and_where(Expr::col(delete_key).eq(Expr::col(event_key)));
    }

    deletions
}

/// Subquery: joins an event to the content it carries, on the content digest.
fn content_join() -> Condition {
    Into::<RelationDef>::into(
        event::Entity::belongs_to(content::Entity)
            .from(event::Column::ContentDigestType)
            .to(content::Column::DigestType)
            .on_condition(|event_tbl, content_tbl| {
                Expr::col((event_tbl, event::Column::ContentDigestBytes))
                    .equals((content_tbl, content::Column::DigestBytes))
                    .into_condition()
            }),
    )
    .into_condition()
}
