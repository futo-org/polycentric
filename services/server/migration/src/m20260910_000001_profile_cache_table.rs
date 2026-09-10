use entity::{content, content_delete, content_profile_update, event, profile};
use sea_orm::{ColumnTrait, EntityTrait, RelationDef};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();

        let mut create_table = TableCreateStatement::new();
        create_table
            .if_not_exists()
            .table(profile::Entity.unquoted())
            .col({
                let mut def = ColumnDef::new(profile::Column::EventId);
                def.primary_key().big_integer().not_null();
                def
            })
            .col({
                let mut def = ColumnDef::new(profile::Column::Identity);
                def.text().not_null();
                def
            })
            .col({
                let mut def = ColumnDef::new(profile::Column::Name);
                def.text().null();
                def
            })
            .col({
                let mut def = ColumnDef::new("search_data");
                def.custom("tsvector").null(); // NOTE: set to NOT NULL below.
                def
            });
        tx.execute(&create_table).await?;

        let mut fill_table = InsertStatement::new();
        fill_table
            .into_table(profile::Entity)
            .columns([
                profile::Column::EventId.unquoted(),
                profile::Column::Identity.unquoted(),
                profile::Column::Name.unquoted(),
                "search_data",
            ])
            .select_from({
                let mut q = SelectStatement::new();
                q
                    // We need to get the id, but because we don't want to
                    // include it in GROUP BY (as that would make each row
                    // unique), we need to use an aggregate function as Postgres
                    // doesn't know we only get one id. So we do this odd CASE
                    // where we double check that the maximum and minimum id
                    // value are the same and then return the maximum (and only)
                    // value. If they are different, which should be impossible,
                    // we blow up by returning NULL.
                    .expr(
                        Expr::case(
                            Expr::col(event::Column::Id.as_column_ref()).max().eq(Expr::col(event::Column::Id.as_column_ref()).min()),
                            Expr::col(event::Column::Id.as_column_ref()).max(),
                        )
                    )
                    .expr(Expr::col(event::Column::Identity.as_column_ref()))
                    .expr(Expr::cust("any_value(content_profile_update.name)"))
                    .expr(Expr::cust("create_tsvector('simple', COALESCE(any_value(content_profile_update.alias), ''), 'A') || create_tsvector('simple', COALESCE(any_value(content_profile_update.name)::TEXT, ''), 'B')"))
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
                        content_profile_update::Entity,
                        Condition::any().add(
                            Expr::col(
                                content_profile_update::Column::ContentId.as_column_ref(),
                            )
                            .eq(Expr::col(content::Column::Id.as_column_ref())),
                        ),
                    )
                    // Make sure the event wasn't deleted.
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
                    )
                    .and_where(Expr::col(event::Column::Collection.as_column_ref()).eq(Expr::Constant(3.into())))
                    .group_by_columns([
                        event::Column::Identity.as_column_ref(),
                        event::Column::Collection.as_column_ref(),
                        event::Column::Sequence.as_column_ref(),
                    ]);
                q
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?
            .on_conflict({
                let mut c = OnConflict::column(profile::Column::EventId);
                c.do_nothing();
                c
            });
        tx.execute(&fill_table).await?;

        let mut alter_table = TableAlterStatement::new();
        alter_table
            .table(profile::Entity.unquoted())
            // Set to NOT NULL.
            .modify_column({
                let mut def = ColumnDef::new("search_data");
                def.custom("tsvector").not_null();
                def
            });
        tx.execute(&alter_table).await?;

        let mut index = Index::create();
        index
            .name("profile_search_data")
            .table(profile::Entity)
            .col("search_data")
            .full_text();
        tx.execute(&index).await?;

        if manager
            .has_column(
                content_profile_update::Entity.unquoted(),
                "search_data",
            )
            .await?
        {
            let mut stmt = Table::alter();
            stmt.table(content_profile_update::Entity.unquoted())
                .drop_column("search_data");
            manager.alter_table(stmt).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let mut drop_table = TableDropStatement::new();
        drop_table
            .if_exists()
            .table(profile::Entity.unquoted())
            .restrict();
        manager.drop_table(drop_table).await?;

        if !manager
            .has_column(
                content_profile_update::Entity.unquoted(),
                "search_data",
            )
            .await?
        {
            let mut stmt = Table::alter();
            stmt.table(content_profile_update::Entity.unquoted())
                .add_column(ColumnDef::new("search_data").custom("tsvector").not_null()
                    .generated(
                        Expr::cust("
                            setweight(to_tsvector('simple', COALESCE(alias, '')), 'A') ||
                            setweight(to_tsvector('simple', COALESCE(name, '')), 'B') ||
                            setweight(to_tsvector('english', COALESCE(description, '')), 'C')
                        "),
                        true /* stored */)
                    );
            manager.alter_table(stmt).await?;
        }

        Ok(())
    }
}
