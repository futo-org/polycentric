use entity::{content, content_delete, content_repost, event, repost};
use sea_orm::{ColumnTrait, EntityTrait, RelationDef};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table(repost::Entity.unquoted()).await? {
            return Ok(());
        }

        let tx = manager.get_connection();

        let mut create_table = TableCreateStatement::new();
        create_table
            .table(repost::Entity.unquoted())
            .col({
                let mut def = ColumnDef::new(repost::Column::EventId);
                def.primary_key().big_integer().not_null();
                def
            })
            .col({
                let mut def = ColumnDef::new(repost::Column::Identity);
                def.text().not_null();
                def
            })
            .col({
                let mut def = ColumnDef::new(repost::Column::Post);
                def.big_integer().not_null();
                def
            });

        tx.execute(&create_table).await?;

        let mut fill_table = InsertStatement::new();
        fill_table
            .into_table(repost::Entity)
            .columns([
                repost::Column::EventId,
                repost::Column::Identity,
                repost::Column::Post,
            ])
            .select_from({
                let mut q = SelectStatement::new();
                q
                    .clear_selects() // Need to rename.
                    .expr(SelectExpr {
                        expr: Expr::col(event::Column::Id.as_column_ref()),
                        alias: Some(repost::Column::EventId.into()),
                        window: None,
                    })
                    .expr(SelectExpr {
                        expr: Expr::col(event::Column::Identity.as_column_ref()),
                        alias: Some(repost::Column::Identity.into()),
                        window: None,
                    })
                    .expr(SelectExpr {
                        expr: Expr::col((
                              "repost_event", event::Column::Id.unquoted(),
                        )),
                        alias: Some(repost::Column::Post.into()),
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
                        content_repost::Entity,
                        Condition::any().add(
                            Expr::col(
                                content_repost::Column::ContentId.as_column_ref(),
                            )
                            .eq(Expr::col(content::Column::Id.as_column_ref())),
                        ),
                    )
                    .inner_join(
                        TableRef::Table(event::Entity.into(), Some("repost_event".into())),
                        Condition::all()
                            .and(Expr::col(content_repost::Column::EventKeyCollection.as_column_ref())
                                .eq(Expr::col(("repost_event", event::Column::Collection))))
                            .and(Expr::col(content_repost::Column::EventKeyIdentity.as_column_ref())
                                .eq(Expr::col(("repost_event", event::Column::Identity))))
                            .and(Expr::col(content_repost::Column::EventKeyPublicKeyType.as_column_ref())
                                .eq(Expr::col(("repost_event", event::Column::PublicKeyType))))
                            .and(Expr::col(content_repost::Column::EventKeyPublicKey.as_column_ref())
                                .eq(Expr::col(("repost_event", event::Column::PublicKey))))
                            .and(Expr::col(content_repost::Column::EventKeySequence.as_column_ref())
                                .eq(Expr::col(("repost_event", event::Column::Sequence))))
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
                    .and_where(
                        Expr::cust(content_delete::Entity.into_iden().inner())
                            .is_null(),
                    );
                q
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?
            .on_conflict({
                let mut c = OnConflict::column(repost::Column::EventId);
                c.do_nothing();
                c
            });

        tx.execute(&fill_table).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_table(repost::Entity.unquoted()).await? {
            return Ok(());
        }

        let mut drop_table = TableDropStatement::new();
        drop_table.table(repost::Entity.unquoted()).restrict();
        manager.drop_table(drop_table).await?;
        Ok(())
    }
}
