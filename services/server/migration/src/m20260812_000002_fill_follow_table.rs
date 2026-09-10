use entity::{content, content_delete, content_follow, event, follow};
use polycentric_common::models::collections;
use sea_orm::RelationDef;
use sea_orm::sea_query::InsertStatement;
use sea_orm::{ColumnTrait, EntityTrait};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();
        let mut followers = SelectStatement::new();
        followers
            .column(event::Column::Id.as_column_ref())
            .column(event::Column::Identity.as_column_ref())
            .column(content_follow::Column::IdentityId.as_column_ref())
            .from(event::Entity)
            .inner_join(
                content::Entity,
                Into::<RelationDef>::into(
                    event::Entity::belongs_to(content::Entity)
                        .from(event::Column::ContentDigestType)
                        .to(content::Column::DigestType)
                        .on_condition(|event_tbl, content_tbl| {
                            Expr::col((
                                event_tbl,
                                event::Column::ContentDigestBytes,
                            ))
                            .equals((content_tbl, content::Column::DigestBytes))
                            .into_condition()
                        }),
                ),
            )
            .inner_join(
                content_follow::Entity,
                Condition::any().add(
                    Expr::col(
                        content_follow::Column::ContentId.as_column_ref(),
                    )
                    .eq(Expr::col(content::Column::Id.as_column_ref())),
                ),
            )
            .left_join(
                content_delete::Entity,
                Condition::all()
                    .add(
                        Expr::col(
                            content_delete::Column::EventKeyCollection
                                .as_column_ref(),
                        )
                        .eq(Expr::col(
                            event::Column::Collection.as_column_ref(),
                        )),
                    )
                    .add(
                        Expr::col(
                            content_delete::Column::EventKeyIdentity
                                .as_column_ref(),
                        )
                        .eq(Expr::col(event::Column::Identity.as_column_ref())),
                    )
                    .add(
                        Expr::col(
                            content_delete::Column::EventKeyPublicKeyType
                                .as_column_ref(),
                        )
                        .eq(Expr::col(
                            event::Column::PublicKeyType.as_column_ref(),
                        )),
                    )
                    .add(
                        Expr::col(
                            content_delete::Column::EventKeyPublicKey
                                .as_column_ref(),
                        )
                        .eq(Expr::col(
                            event::Column::PublicKey.as_column_ref(),
                        )),
                    )
                    .add(
                        Expr::col(
                            content_delete::Column::EventKeySequence
                                .as_column_ref(),
                        )
                        .eq(Expr::col(event::Column::Sequence.as_column_ref())),
                    ),
            )
            .and_where(event::Column::Collection.eq(collections::SOCIAL_GRAPH))
            .and_where(
                Expr::cust(content_delete::Entity.into_iden().inner())
                    .is_null(),
            );

        let mut followers = tx
            .query_all(&followers)
            .await?
            .into_iter()
            .map(|result| {
                result.try_get_many_by_index::<(i64, String, String)>()
            })
            .collect::<Result<Vec<_>, _>>()?;

        if followers.is_empty() {
            // Done quickly.
            return Ok(());
        }

        // Sort by event id to help Postgres primary key index creation.
        followers.sort_by_key(|m| m.0);

        let follow_rows = InsertStatement::new()
            .into_table(follow::Entity)
            .columns([
                follow::Column::EventId,
                follow::Column::Follower,
                follow::Column::Followee,
            ])
            .values_from_panic(followers.into_iter().map(
                |(event_id, follower, followee)| {
                    [
                        Expr::from(event_id),
                        Expr::from(follower),
                        Expr::from(followee),
                    ]
                },
            ))
            .on_conflict({
                let mut c = OnConflict::column(follow::Column::EventId);
                c.do_nothing();
                c
            })
            .take();

        tx.execute(&follow_rows).await?;
        Ok(())
    }

    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        // Not undoing a data migration.
        Ok(())
    }
}
