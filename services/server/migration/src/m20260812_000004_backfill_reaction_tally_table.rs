use entity::{content, content_delete, content_post, content_reaction, event};
use polycentric_common::models::collections;
use sea_orm::{ColumnTrait, EntityTrait, RelationDef};

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();

        // Get the event ids for all not-deleted posts.
        let mut posts = SelectStatement::new();
        posts
            .column(event::Column::Id.as_column_ref())
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
                content_post::Entity,
                Condition::any().add(
                    Expr::col(content_post::Column::ContentId.as_column_ref())
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
            .and_where(event::Column::Collection.eq(collections::FEED))
            .and_where(
                Expr::cust(content_delete::Entity.into_iden().inner())
                    .is_null(),
            )
            .order_by(event::Column::Id.as_column_ref(), Order::Asc);

        // Insert the reactions.
        let mut reactions = InsertStatement::new();
        reactions
            .into_table("reaction")
            .columns(["event_id", "on_post", "emoji", "positive"])
            .select_from({
                let mut q = SelectStatement::new();
                q.expr(SelectExpr {
                    expr: Expr::col(event::Column::Id.as_column_ref()),
                    alias: Some("event_id".into()),
                    window: None,
                })
                .expr(SelectExpr {
                    expr: Expr::col(("post_event", event::Column::Id)),
                    alias: Some("on_post".into()),
                    window: None,
                })
                .expr(SelectExpr {
                    expr: Expr::col(
                        content_reaction::Column::Emoji.as_column_ref(),
                    ),
                    alias: Some("emoji".into()),
                    window: None,
                })
                .expr(SelectExpr {
                    expr: Expr::col(
                        content_reaction::Column::Positive.as_column_ref(),
                    ),
                    alias: Some("positive".into()),
                    window: None,
                })
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
                                .equals((
                                    content_tbl,
                                    content::Column::DigestBytes,
                                ))
                                .into_condition()
                            }),
                    ),
                )
                .inner_join(
                    content_reaction::Entity,
                    Condition::any().add(
                        Expr::col(
                            content_reaction::Column::ContentId.as_column_ref(),
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
                            .eq(Expr::col(
                                event::Column::Identity.as_column_ref(),
                            )),
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
                            .eq(Expr::col(
                                event::Column::Sequence.as_column_ref(),
                            )),
                        ),
                )
                .inner_join(
                    TableRef::from(event::Entity).alias("post_event"),
                    Condition::all()
                        .add(
                            Expr::col(
                                content_reaction::Column::EventKeyCollection
                                    .as_column_ref(),
                            )
                            .eq(Expr::col((
                                "post_event",
                                event::Column::Collection,
                            ))),
                        )
                        .add(
                            Expr::col(
                                content_reaction::Column::EventKeyIdentity
                                    .as_column_ref(),
                            )
                            .eq(Expr::col((
                                "post_event",
                                event::Column::Identity,
                            ))),
                        )
                        .add(
                            Expr::col(
                                content_reaction::Column::EventKeyPublicKeyType
                                    .as_column_ref(),
                            )
                            .eq(Expr::col((
                                "post_event",
                                event::Column::PublicKeyType,
                            ))),
                        )
                        .add(
                            Expr::col(
                                content_reaction::Column::EventKeyPublicKey
                                    .as_column_ref(),
                            )
                            .eq(Expr::col((
                                "post_event",
                                event::Column::PublicKey,
                            ))),
                        )
                        .add(
                            Expr::col(
                                content_reaction::Column::EventKeySequence
                                    .as_column_ref(),
                            )
                            .eq(Expr::col((
                                "post_event",
                                event::Column::Sequence,
                            ))),
                        ),
                )
                .and_where(
                    Expr::cust(content_delete::Entity.into_iden().inner())
                        .is_null(),
                )
                .and_where(
                    Expr::col(("post_event", event::Column::Id)).in_subquery({
                        let mut q = SelectStatement::new();
                        q.column("id").from("post");
                        q
                    }),
                );
                q
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?
            .returning_all();

        // Sum the inserted reactions.
        let mut sum_reactions = SelectStatement::new();
        sum_reactions
            .expr(SelectExpr {
                expr: Expr::col(("reaction", "on_post")),
                alias: Some("post_event_id".into()),
                window: None,
            })
            .expr(SelectExpr {
                expr: Expr::cust(
                    "SUM(CASE WHEN reaction.positive THEN 1 ELSE 0 END)",
                ),
                alias: Some("positive_count".into()),
                window: None,
            })
            .expr(SelectExpr {
                expr: Expr::cust(
                    "SUM(CASE WHEN reaction.positive THEN 0 ELSE 1 END)",
                ),
                alias: Some("negative_count".into()),
                window: None,
            })
            .from("reaction")
            .group_by_col(("reaction", "on_post"));

        // Insert the reaction tallies.
        let mut query = InsertStatement::new();
        let mut with = WithClause::new();
        let mut post_cte = CommonTableExpression::new();
        post_cte.table_name("post").query(posts);
        let mut reaction_cte = CommonTableExpression::new();
        reaction_cte.table_name("reaction").query(reactions);
        let mut sum_reaction_cte = CommonTableExpression::new();
        sum_reaction_cte
            .table_name("sum_reaction")
            .query(sum_reactions);
        with.recursive(false)
            .cte(post_cte)
            .cte(reaction_cte)
            .cte(sum_reaction_cte);
        query
            .with_cte(with)
            .into_table("reaction_tally")
            .columns(["event_id", "positive_count", "negative_count"])
            .select_from({
                let mut q = SelectStatement::new();
                q.expr(SelectExpr {
                    expr: Expr::col(("post", "id")),
                    alias: Some("event_id".into()),
                    window: None,
                })
                .expr(SelectExpr {
                    expr: Expr::cust(
                        "COALESCE(sum_reaction.positive_count, 0)",
                    ),
                    alias: Some("positive_count".into()),
                    window: None,
                })
                .expr(SelectExpr {
                    expr: Expr::cust(
                        "COALESCE(sum_reaction.negative_count, 0)",
                    ),
                    alias: Some("negative_count".into()),
                    window: None,
                })
                .from("post")
                .left_join(
                    "sum_reaction",
                    Expr::col(("post", "id"))
                        .eq(Expr::col(("sum_reaction", "post_event_id"))),
                );
                q
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?
            .on_conflict({
                let mut c = OnConflict::column("event_id");
                c.do_nothing();
                c
            });

        tx.execute(&query).await?;
        Ok(())
    }

    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        // Not undoing a data migration.
        Ok(())
    }
}
