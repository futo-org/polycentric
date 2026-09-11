use crate::config;
use crate::service::content::content_repository::Mutation as ContentRepository;
use crate::service::content::repository::Mutation as ContentChildRepository;
use crate::service::content::repository::{EventKeyParts, split_event_key};
use crate::service::events::rpc::put_events::event_is_authorised;
use ::entity::{
    application, block, content, content_delete, event, follow, profile, quote,
    reaction, reaction_tally, reply, repost,
};
use chrono::Utc;
use polycentric_common::models::collections;
use polycentric_common::models::protos_v2::content::ContentBody;
use polycentric_common::models::protos_v2::{
    Application, Block, Content, ContentDigest, Delete, EventKey, Follow, Post,
    ProfileUpdate, Reaction, Repost,
};
use sea_orm::sea_query::{
    CommonTableExpression, DeleteStatement, Expr, Func, InsertStatement,
    IntoCondition, IntoTableRef, OnConflict, SelectExpr, SelectStatement,
    SubQueryStatement, UpdateStatement, WithClause,
};
use sea_orm::*;
use tonic::Status;

const COLLECTION_FEED: i16 = collections::FEED as i16;
const COLLECTION_PROFILE: i16 = collections::PROFILE as i16;
const COLLECTION_SOCIAL: i16 = collections::SOCIAL_GRAPH as i16;
const COLLECTION_INTERACTIONS: i16 = collections::INTERACTIONS as i16;

pub struct Query;

impl Query {
    #[allow(clippy::too_many_arguments)]
    pub async fn list_events(
        db: &DbConn,
        mut limit: Option<u64>,
        collection: Option<i32>,
        identity: Option<String>,
        signed_by: Option<crate::service::proto::PublicKey>,
        sequence_gt: Option<i64>,
        sequence_lt: Option<i64>,
        heads: Vec<EventKey>,
    ) -> Result<Vec<(event::Model, Option<content::Model>)>, DbErr> {
        if limit > Some(200) || limit.is_none() {
            limit = Some(200);
        }

        let mut query =
            event::Entity::find().select_also(content::Entity).join(
                JoinType::LeftJoin,
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
                    })
                    .into(),
            );

        if let Some(c) = collection {
            query = query.filter(event::Column::Collection.eq(c as i16));
        }

        if let Some(id) = identity {
            query = query.filter(event::Column::Identity.eq(id));
        }

        if let Some(pk) = signed_by {
            query = query.filter(
                Condition::all()
                    .add(event::Column::PublicKeyType.eq(pk.key_type as i16))
                    .add(event::Column::PublicKey.eq(pk.key)),
            );
        }

        if let Some(gt) = sequence_gt {
            query = query.filter(event::Column::Sequence.gt(gt));
        }

        if let Some(lt) = sequence_lt {
            query = query.filter(event::Column::Sequence.lt(lt));
        }

        for head in heads {
            let Some(signer) = head.signed_by else {
                continue;
            };

            // Require the event to either
            // (1) mismatch the head's collection, signer, or identity
            // (2) have a larger sequence number than the head
            query = query.filter(
                Condition::any()
                    .add(event::Column::Collection.ne(head.collection as i16))
                    .add(event::Column::Identity.ne(head.identity))
                    .add(
                        event::Column::PublicKeyType.ne(signer.key_type as i16),
                    )
                    .add(event::Column::PublicKey.ne(signer.key))
                    .add(event::Column::Sequence.gt(head.sequence as i64)),
            )
        }

        query
            .order_by_desc(event::Column::Sequence)
            .limit(limit)
            .all(db)
            .await
    }

    /// Find the latest sequence numbers for an identity
    pub async fn list_heads(
        db: &DbConn,
        identity: &str,
    ) -> Result<Vec<HeadInfoRow>, DbErr> {
        event::Entity::find()
            .select_only()
            .filter(event::Column::Identity.eq(identity))
            .column(event::Column::PublicKeyType)
            .column(event::Column::PublicKey)
            .column(event::Column::Collection)
            .column_as(event::Column::Sequence.max(), "max_seq")
            .group_by(event::Column::PublicKeyType)
            .group_by(event::Column::PublicKey)
            .group_by(event::Column::Collection)
            .into_model::<HeadInfoRow>()
            .all(db)
            .await
    }
}

#[derive(Debug, FromQueryResult)]
pub struct HeadInfoRow {
    pub public_key_type: i16,
    pub public_key: Vec<u8>,
    pub collection: i16,
    pub max_seq: i64,
}

pub struct Mutation;

impl Mutation {
    /// Find or create the `application` row for `app`, returning its id.
    pub async fn application_id<C: ConnectionTrait>(
        db: &C,
        app: &Application,
    ) -> Result<i32, DbErr> {
        // Keep client-supplied strings within the unique index's limits.
        const MAX_LEN: usize = 256;
        let bounded = |s: &str| s.chars().take(MAX_LEN).collect::<String>();

        let row = application::ActiveModel {
            id: NotSet,
            name: Set(bounded(&app.name)),
            identifier: Set(bounded(&app.id)),
            version: Set(bounded(&app.version)),
            url: Set(bounded(&app.url)),
        };
        // A no-op update makes the existing row's id come back on conflict.
        let inserted = application::Entity::insert(row)
            .on_conflict(
                OnConflict::columns([
                    application::Column::Name,
                    application::Column::Identifier,
                    application::Column::Version,
                    application::Column::Url,
                ])
                .update_column(application::Column::Name)
                .to_owned(),
            )
            .exec(db)
            .await?;
        Ok(inserted.last_insert_id)
    }

    /// Store an event and it's content.
    ///
    /// Returns `true` if the event was stored or `false` if the event is
    /// already stored.
    pub async fn add_event<C: ConnectionTrait>(
        db: &C,
        event: event::ActiveModel,
        decoded_content: Option<(&[u8], Content, &ContentDigest)>,
    ) -> Result<bool, Status> {
        // We're going to build one big query using Common Table Expressions
        // (CTE) store everything related to a single event in one query. We do
        // this for performance reasons.
        //
        // NOTE: data-modifying statement must be at the top level for Postgres,
        // so various sub-queries add to this.
        let mut with = WithClause::new();
        with.recursive(false);

        let identity = event.identity.try_as_ref().map_or("", |s| &**s);
        let content = decoded_content.as_ref().map(|(_, c, _)| c);
        let is_authorised = event_is_authorised(identity, content);

        // Store the event itself into the `events` table.
        const INSERTED_EVENT: &str = "inserted_event";
        let mut insert_event = event::Entity::insert(event).into_query();
        insert_event.returning_all();
        let mut cte = CommonTableExpression::new();
        cte.table_name(INSERTED_EVENT).query(insert_event);
        with.cte(cte);

        if let Some((serialized_bytes, content, digest)) = decoded_content {
            // Store the content of the event, if not already stored (for an
            // event with the same content).
            const INSERTED_CONTENT: &str = "inserted_content";
            let insert_content =
                ContentRepository::add_content_query(serialized_bytes, digest);
            let mut cte = CommonTableExpression::new();
            cte.table_name(INSERTED_CONTENT).query(insert_content);
            with.cte(cte);

            if let Some(content_body) = content.content_body {
                // Update cache tables.
                if is_authorised {
                    let event_id_identity = (
                        INSERTED_EVENT.into(),
                        event::Column::Id.into(),
                        event::Column::Identity.into(),
                    );
                    let maybe_query = Mutation::update_cache_query(
                        &mut with,
                        &content_body,
                        event_id_identity,
                    ).map_err(|err| {
                        tracing::error!(error = %err, "failed to create query to update cache tables");
                        Status::internal("internal server error")
                    })?;
                    if let Some(query) = maybe_query {
                        let mut cte = CommonTableExpression::new();
                        cte.table_name("inserted_cache").query(query);
                        with.cte(cte);
                    }
                }

                // Store the decoded body of the content.
                let content_id =
                    (INSERTED_CONTENT.into(), content::Column::Id.into());
                let event_identity =
                    (INSERTED_EVENT.into(), event::Column::Identity.into());
                if let Some(query) =
                    ContentChildRepository::save_content_body_query(
                        &mut with,
                        content_body,
                        content_id,
                        event_identity,
                    )?
                {
                    let mut cte = CommonTableExpression::new();
                    cte.table_name("inserted_content_body").query(query);
                    with.cte(cte);
                }
            }
        }

        // Dummy query to which we attached everything.
        let mut query = SelectStatement::new();
        query.expr(Expr::Constant(true.into()));
        let query = query.with(with);

        match db.execute(&query).await {
            Ok(_) => Ok(true),
            Err(ref err) if is_unique_violation(err) => Ok(false),
            Err(err) => {
                tracing::error!(error = %err, "failed to store event");
                Err(Status::internal("internal server error"))
            }
        }
    }

    /// Returns a query to update the cache tables.
    ///
    /// Caller must ensure that the event is authorised, i.e. not an event
    /// created by identity A that is deleting an event of identity B.
    pub fn update_cache_query(
        with: &mut WithClause,
        content_body: &ContentBody,
        event_id_identity: (DynIden, DynIden, DynIden),
    ) -> Result<Option<SubQueryStatement>, DbErr> {
        match content_body {
            ContentBody::Post(post) => {
                Mutation::post_query(with, post, event_id_identity)
                    .map(|q| Some(q.into()))
            }
            ContentBody::Follow(follow) => {
                Mutation::follow_query(follow, event_id_identity)
                    .map(|q| Some(q.into()))
            }
            ContentBody::Block(block) => {
                Mutation::block_query(block, event_id_identity)
                    .map(|q| Some(q.into()))
            }
            ContentBody::Reaction(reaction) => {
                Mutation::reaction_query(with, reaction, event_id_identity)
                    .map(|q| Some(q.into()))
            }
            ContentBody::ProfileUpdate(update) => {
                Mutation::profile_update_query(with, update, event_id_identity)
                    .map(|q| Some(q.into()))
            }
            ContentBody::Repost(repost) => {
                Mutation::repost_query(repost, event_id_identity)
                    .map(|q| Some(q.into()))
            }
            ContentBody::Delete(delete) => Mutation::delete_query(with, delete),
            _ => Ok(None),
        }
    }

    fn post_query(
        with: &mut WithClause,
        post: &Post,
        (event_table, event_id, identity): (DynIden, DynIden, DynIden),
    ) -> Result<InsertStatement, DbErr> {
        let mut query = InsertStatement::new();
        query
            .into_table(reaction_tally::Entity)
            .columns([
                reaction_tally::Column::EventId,
                reaction_tally::Column::PositiveCount,
                reaction_tally::Column::NegativeCount,
                reaction_tally::Column::DecayedCount,
            ])
            .select_from({
                let mut q = SelectStatement::new();
                q.from(event_table.clone())
                    .expr(Expr::col((event_table.clone(), event_id.clone())))
                    .expr(Expr::Constant(0.into()))
                    .expr(Expr::Constant(0.into()))
                    .expr(reaction_count_decay(
                        Expr::Constant(0.into()), // Reaction count.
                        // NOTE: this timestamp isn't 100% accurate, but for a
                        // post without reactions that shouldn't really matter.
                        Expr::from(Utc::now()),
                    ));
                q
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?;

        if let Some(quote) = post.quote.as_ref() {
            let key = split_event_key(Some(quote.clone()), "quote")
                .map_err(|err| DbErr::Custom(err.message().into()))?;
            let mut post_event_id = select_not_deleted_event_id(key);

            let mut insert_quote = InsertStatement::new();
            insert_quote
                .into_table(quote::Entity)
                .columns([
                    quote::Column::EventId,
                    quote::Column::Identity,
                    quote::Column::Post,
                ])
                .select_from({
                    post_event_id
                        .clear_selects() // Need to rename.
                        .from(event_table.clone())
                        .expr(SelectExpr {
                            expr: Expr::col((
                                event_table.clone(),
                                event_id.clone(),
                            )),
                            alias: Some(quote::Column::EventId.into()),
                            window: None,
                        })
                        .expr(SelectExpr {
                            expr: Expr::col((
                                event_table.clone(),
                                identity.clone(),
                            )),
                            alias: Some(quote::Column::Identity.into()),
                            window: None,
                        })
                        .expr(SelectExpr {
                            expr: Expr::col(event::Column::Id.as_column_ref()),
                            alias: Some(quote::Column::Post.into()),
                            window: None,
                        });
                    post_event_id
                })
                .map_err(|err| {
                    DbErr::Custom(format!("incorrect amount of values: {err}"))
                })?;

            let mut cte = CommonTableExpression::new();
            cte.table_name("inserted_quote").query(insert_quote);
            with.cte(cte);
        }

        if let Some(reply) = post.reply.as_ref()
            && let Some(reply) = &reply.parent
        {
            // NOTE: only adding a reply to the parent, not for the root.
            let key = split_event_key(Some(reply.clone()), "reply")
                .map_err(|err| DbErr::Custom(err.message().into()))?;
            let mut post_event_id = select_not_deleted_event_id(key);

            let mut insert_reply = InsertStatement::new();
            insert_reply
                .into_table(reply::Entity)
                .columns([
                    reply::Column::EventId,
                    reply::Column::Identity,
                    reply::Column::Post,
                ])
                .select_from({
                    post_event_id
                        .clear_selects()
                        .from(event_table.clone())
                        .expr(SelectExpr {
                            expr: Expr::col((event_table.clone(), event_id)),
                            alias: Some(reply::Column::EventId.into()),
                            window: None,
                        })
                        .expr(SelectExpr {
                            expr: Expr::col((
                                event_table.clone(),
                                identity.clone(),
                            )),
                            alias: Some(reply::Column::Identity.into()),
                            window: None,
                        })
                        .expr(SelectExpr {
                            expr: Expr::col(event::Column::Id.as_column_ref()),
                            alias: Some(reply::Column::Post.into()),
                            window: None,
                        });
                    post_event_id
                })
                .map_err(|err| {
                    DbErr::Custom(format!("incorrect amount of values: {err}"))
                })?;

            let mut cte = CommonTableExpression::new();
            cte.table_name("inserted_reply").query(insert_reply);
            with.cte(cte);
        }

        Ok(query)
    }

    fn follow_query(
        follow: &Follow,
        (event_table, event_id, identity): (DynIden, DynIden, DynIden),
    ) -> Result<InsertStatement, DbErr> {
        let mut query = InsertStatement::new();
        query
            .into_table(follow::Entity)
            .columns([
                follow::Column::EventId,
                follow::Column::Follower,
                follow::Column::Followee,
            ])
            .select_from({
                let mut q = SelectStatement::new();
                q.from(event_table.clone())
                    .expr(Expr::col((event_table.clone(), event_id)))
                    .expr(Expr::col((event_table, identity)))
                    .expr(Expr::from(follow.identity.clone()));
                q
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?;
        Ok(query)
    }

    fn block_query(
        block: &Block,
        (event_table, event_id, identity): (DynIden, DynIden, DynIden),
    ) -> Result<InsertStatement, DbErr> {
        let mut query = InsertStatement::new();
        query
            .into_table(block::Entity)
            .columns([
                block::Column::EventId,
                block::Column::Blocker,
                block::Column::Blocked,
            ])
            .select_from({
                let mut q = SelectStatement::new();
                q.from(event_table.clone())
                    .expr(Expr::col((event_table.clone(), event_id)))
                    .expr(Expr::col((event_table, identity)))
                    .expr(Expr::from(block.identity.clone()));
                q
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?;
        Ok(query)
    }

    fn reaction_query(
        with: &mut WithClause,
        reaction: &Reaction,
        (event_table, event_id, identity): (DynIden, DynIden, DynIden),
    ) -> Result<UpdateStatement, DbErr> {
        let key = split_event_key(reaction.event_key.clone(), "reaction")
            .map_err(|err| DbErr::Custom(err.message().into()))?;
        let mut post_event_id = select_not_deleted_event_id(key);

        let mut insert_reaction = InsertStatement::new();
        insert_reaction
            .into_table(reaction::Entity)
            .columns([
                reaction::Column::EventId,
                reaction::Column::Identity,
                reaction::Column::OnPost,
                reaction::Column::Emoji,
                reaction::Column::Positive,
            ])
            .select_from({
                post_event_id
                    .clear_selects() // Need to rename.
                    .from(event_table.clone())
                    .expr(SelectExpr {
                        expr: Expr::col((event_table.clone(), event_id)),
                        alias: Some("event_id".into()),
                        window: None,
                    })
                    .expr(SelectExpr {
                        expr: Expr::col((event_table, identity)),
                        alias: Some("identity".into()),
                        window: None,
                    })
                    .expr(SelectExpr {
                        expr: Expr::col(event::Column::Id.as_column_ref()),
                        alias: Some("on_post".into()),
                        window: None,
                    })
                    .expr(SelectExpr {
                        expr: Expr::from(reaction.emoji.clone()),
                        alias: Some("emoji".into()),
                        window: None,
                    })
                    .expr(SelectExpr {
                        expr: Expr::from(reaction.positive),
                        alias: Some("positive".into()),
                        window: None,
                    });
                post_event_id
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?
            .returning_all();

        let mut cte = CommonTableExpression::new();
        const INSERTED_REACTION: &str = "inserted_reaction";
        cte.table_name(INSERTED_REACTION).query(insert_reaction);
        with.cte(cte);

        let positive = if reaction.positive { 1 } else { 0 };
        let negative = if reaction.positive { 0 } else { 1 };

        let mut query = UpdateStatement::new();
        query.table(reaction_tally::Entity).values([
            (
                reaction_tally::Column::PositiveCount,
                Expr::col(
                    reaction_tally::Column::PositiveCount.as_column_ref(),
                )
                .add(Expr::Constant(positive.into())),
            ),
            (
                reaction_tally::Column::NegativeCount,
                Expr::col(
                    reaction_tally::Column::NegativeCount.as_column_ref(),
                )
                .add(Expr::Constant(negative.into())),
            ),
        ]);

        if reaction.positive {
            query.value(
                reaction_tally::Column::DecayedCount,
                reaction_count_decay(
                    Expr::col(
                        reaction_tally::Column::PositiveCount.as_column_ref(),
                    )
                    .add(Expr::Constant(positive.into())),
                    Expr::col(event::Column::CreatedAt.as_column_ref()),
                ),
            );
        }

        query
            .from(INSERTED_REACTION)
            // This should be an inner join, but SeaORM doesn't support this,
            // see <https://github.com/SeaQL/sea-query/issues/608>.
            .from(event::Entity)
            .and_where(
                Expr::col(event::Column::Id.as_column_ref())
                    .eq(Expr::Column((INSERTED_REACTION, "on_post").into())),
            )
            .and_where(
                Expr::Column(("reaction_tally", "event_id").into())
                    .eq(Expr::Column((INSERTED_REACTION, "on_post").into())),
            );

        Ok(query)
    }

    fn profile_update_query(
        with: &mut WithClause,
        update: &ProfileUpdate,
        (event_table, event_id, identity): (DynIden, DynIden, DynIden),
    ) -> Result<InsertStatement, DbErr> {
        // Delete the previous profile.
        let mut delete_old_profile = DeleteStatement::new();
        delete_old_profile.from_table(profile::Entity).cond_where(
            profile::Column::Identity.in_subquery({
                let mut q = SelectStatement::new();
                q.from(event_table.clone())
                    .expr(Expr::col((event_table.clone(), identity.clone())));
                q
            }),
        );
        let mut cte = CommonTableExpression::new();
        cte.table_name("delete_old_profile")
            .query(delete_old_profile);
        with.cte(cte);

        // Insert the new profile.
        let mut query = InsertStatement::new();
        query
            .into_table(profile::Entity)
            .columns([
                profile::Column::EventId.unquoted(),
                profile::Column::Identity.unquoted(),
                profile::Column::Name.unquoted(),
                "search_data",
            ])
            .select_from({
                let mut q = SelectStatement::new();
                q.from(event_table.clone())
                    .expr(Expr::col((event_table.clone(), event_id)))
                    .expr(Expr::col((event_table.clone(), identity.clone())))
                    .expr(Expr::from(update.name.clone()))
                    .expr(Expr::cust_with_exprs(
                        "  create_tsvector('simple', COALESCE($1, ''), 'A')
                        || create_tsvector('simple', $2, 'A')
                        || create_tsvector('simple', COALESCE($3, ''), 'B')",
                        [
                            Expr::from(update.alias.clone()),
                            Expr::col((event_table, identity)),
                            Expr::from(update.name.clone()),
                        ],
                    ));
                q
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?;

        Ok(query)
    }

    fn repost_query(
        repost: &Repost,
        (event_table, event_id, identity): (DynIden, DynIden, DynIden),
    ) -> Result<InsertStatement, DbErr> {
        let key = split_event_key(repost.post.clone(), "repost")
            .map_err(|err| DbErr::Custom(err.message().into()))?;
        let mut post_event_id = select_not_deleted_event_id(key);

        let mut query = InsertStatement::new();
        query
            .into_table(repost::Entity)
            .columns([
                repost::Column::EventId,
                repost::Column::Identity,
                repost::Column::Post,
            ])
            .select_from({
                post_event_id
                    .clear_selects() // Need to rename.
                    .from(event_table.clone())
                    .expr(SelectExpr {
                        expr: Expr::col((event_table.clone(), event_id)),
                        alias: Some(repost::Column::EventId.into()),
                        window: None,
                    })
                    .expr(SelectExpr {
                        expr: Expr::col((event_table.clone(), identity)),
                        alias: Some(repost::Column::Identity.into()),
                        window: None,
                    })
                    .expr(SelectExpr {
                        expr: Expr::col(event::Column::Id.as_column_ref()),
                        alias: Some(repost::Column::Post.into()),
                        window: None,
                    });
                post_event_id
            })
            .map_err(|err| {
                DbErr::Custom(format!("incorrect amount of values: {err}"))
            })?;

        Ok(query)
    }

    fn delete_query(
        with: &mut WithClause,
        delete: &Delete,
    ) -> Result<Option<SubQueryStatement>, DbErr> {
        let key = split_event_key(delete.event_key.clone(), "delete content")
            .map_err(|err| DbErr::Custom(err.message().into()))?;
        let collection = key.collection;
        let event_id = select_event_id(key);

        match collection {
            // Deletion of a post.
            COLLECTION_FEED => {
                let mut cte = CommonTableExpression::new();
                cte.table_name("event_id").query(event_id);
                with.cte(cte);

                // Delete the tally for the post.
                let mut delete_reaction_tally = DeleteStatement::new();
                delete_reaction_tally
                    .from_table(reaction_tally::Entity)
                    .cond_where(
                        Expr::col(reaction_tally::Column::EventId).in_subquery(
                            {
                                let mut q = SelectStatement::new();
                                q.column("id").from("event_id");
                                q
                            },
                        ),
                    );
                let mut cte = CommonTableExpression::new();
                cte.table_name("deleted_reaction_tally")
                    .query(delete_reaction_tally);
                with.cte(cte);

                // Delete quotes from the posts itself and quoting the deleted
                // post.
                let mut delete_quotes = DeleteStatement::new();
                delete_quotes.from_table(quote::Entity).cond_where(
                    Condition::any()
                        // The now deleted post qouting another post.
                        .add(Expr::col(quote::Column::EventId).in_subquery({
                            let mut q = SelectStatement::new();
                            q.column("id").from("event_id");
                            q
                        }))
                        // The now deleted post being qouted.
                        .add(Expr::col(quote::Column::Post).in_subquery({
                            let mut q = SelectStatement::new();
                            q.column("id").from("event_id");
                            q
                        })),
                );
                let mut cte = CommonTableExpression::new();
                cte.table_name("deleted_quotes").query(delete_quotes);
                with.cte(cte);

                // Delete replies from the posts itself and replying to the
                // deleted post.
                let mut delete_replies = DeleteStatement::new();
                delete_replies.from_table(reply::Entity).cond_where(
                    Condition::any()
                        // The now deleted post replying to another post.
                        .add(Expr::col(reply::Column::EventId).in_subquery({
                            let mut q = SelectStatement::new();
                            q.column("id").from("event_id");
                            q
                        }))
                        // The now deleted post being replied to.
                        .add(Expr::col(reply::Column::Post).in_subquery({
                            let mut q = SelectStatement::new();
                            q.column("id").from("event_id");
                            q
                        })),
                );
                let mut cte = CommonTableExpression::new();
                cte.table_name("deleted_replies").query(delete_replies);
                with.cte(cte);

                // Delete all reactions to the post.
                let mut query = DeleteStatement::new();
                query.from_table(reaction::Entity).cond_where(
                    Expr::col(reaction::Column::OnPost).in_subquery({
                        let mut q = SelectStatement::new();
                        q.column("id").from("event_id");
                        q
                    }),
                );

                Ok(Some(query.into()))
            }
            COLLECTION_PROFILE => {
                let mut delete_profile = DeleteStatement::new();
                delete_profile
                    .from_table(profile::Entity)
                    .cond_where(profile::Column::EventId.in_subquery(event_id));
                Ok(Some(delete_profile.into()))
            }
            // Deletion of a following or of a block. The event key does not
            // say which, so clear both caches.
            COLLECTION_SOCIAL => {
                let mut cte = CommonTableExpression::new();
                cte.table_name("event_id").query(event_id);
                with.cte(cte);

                for (name, table) in [
                    ("deleted_follows", follow::Entity.into_table_ref()),
                    ("deleted_blocks", block::Entity.into_table_ref()),
                ] {
                    let mut cte = CommonTableExpression::new();
                    cte.table_name(name).query(delete_cached_rows(table));
                    with.cte(cte);
                }

                // All delete queries are added a CTEs.
                Ok(None)
            }
            // Deletion of a reaction and updating the tally.
            COLLECTION_INTERACTIONS => {
                let mut delete_reaction = DeleteStatement::new();
                delete_reaction
                    .from_table("reaction")
                    .cond_where(Expr::col("event_id").in_subquery(event_id))
                    .returning_all();
                let mut cte = CommonTableExpression::new();
                cte.table_name("deleted_reaction").query(delete_reaction);
                with.cte(cte);

                let mut query = UpdateStatement::new();
                query
                    .table(reaction_tally::Entity)
                    .values([
                        (
                            reaction_tally::Column::PositiveCount,
                            Expr::col(
                                reaction_tally::Column::PositiveCount
                                    .as_column_ref(),
                            )
                            .sub(
                                Expr::case(
                                    Expr::Column("positive".into()),
                                    Expr::Constant(1.into()),
                                )
                                .finally(Expr::Constant(0.into())),
                            ),
                        ),
                        (
                            reaction_tally::Column::NegativeCount,
                            Expr::col(
                                reaction_tally::Column::NegativeCount
                                    .as_column_ref(),
                            )
                            .sub(
                                Expr::case(
                                    Expr::Column("positive".into()),
                                    Expr::Constant(0.into()),
                                )
                                .finally(Expr::Constant(1.into())),
                            ),
                        ),
                        (
                            reaction_tally::Column::DecayedCount,
                            Expr::case(
                                Expr::Column("positive".into()),
                                reaction_count_decay(
                                    Expr::col(
                                        reaction_tally::Column::PositiveCount
                                            .as_column_ref(),
                                    ),
                                    Expr::col(
                                        event::Column::CreatedAt
                                            .as_column_ref(),
                                    ),
                                ),
                            )
                            // No change.
                            .finally(Expr::col(
                                reaction_tally::Column::DecayedCount
                                    .as_column_ref(),
                            ))
                            .into(),
                        ),
                    ])
                    .from("deleted_reaction")
                    // This should be an inner join, but SeaORM doesn't support this,
                    // see <https://github.com/SeaQL/sea-query/issues/608>.
                    .from(event::Entity)
                    .and_where(Expr::col(event::Column::Id.as_column_ref()).eq(
                        Expr::col(
                            reaction_tally::Column::EventId.as_column_ref(),
                        ),
                    ))
                    .and_where(
                        Expr::col(
                            reaction_tally::Column::EventId.as_column_ref(),
                        )
                        .eq(Expr::Column(
                            ("deleted_reaction", "on_post").into(),
                        )),
                    );
                Ok(Some(query.into()))
            }
            // Nothing to delete.
            _ => Ok(None),
        }
    }
}

fn is_unique_violation(err: &sea_orm::DbErr) -> bool {
    let runtime_err = match err {
        sea_orm::DbErr::Query(e) | sea_orm::DbErr::Exec(e) => Some(e),
        _ => None,
    };
    if let Some(sea_orm::RuntimeErr::SqlxError(arc_err)) = runtime_err
        && let Some(db_err) = arc_err.as_database_error()
    {
        return db_err.is_unique_violation();
    }
    false
}

/// Helper that returns a delete statement that deletes rows present in
/// an expected outer `event_id` table.
fn delete_cached_rows<T: IntoTableRef>(table: T) -> DeleteStatement {
    let mut query = DeleteStatement::new();
    query
        .from_table(table)
        .cond_where(Expr::col("event_id").in_subquery({
            let mut q = SelectStatement::new();
            q.column("id").from("event_id");
            q
        }));
    query
}

/// Returns a select statement to get the event id from `key`.
fn select_event_id(key: EventKeyParts) -> SelectStatement {
    let mut query = SelectStatement::new();
    query
        .column(event::Column::Id)
        .from(event::Entity)
        .and_where(event::Column::Collection.eq(key.collection))
        .and_where(event::Column::Identity.eq(key.identity))
        .and_where(event::Column::PublicKeyType.eq(key.public_key_type))
        .and_where(event::Column::PublicKey.eq(key.public_key))
        .and_where(event::Column::Sequence.eq(key.sequence));
    query
}

fn select_not_deleted_event_id(key: EventKeyParts) -> SelectStatement {
    let mut query = select_event_id(key);
    // Make sure the post is not deleted.
    query.and_where(Expr::not_exists({
        let mut q = SelectStatement::new();
        q.expr(Expr::Constant(true.into()))
            .from(content_delete::Entity)
            .and_where(
                Expr::col(
                    content_delete::Column::EventKeyCollection.as_column_ref(),
                )
                .eq(Expr::col(event::Column::Collection.as_column_ref())),
            )
            .and_where(
                Expr::col(
                    content_delete::Column::EventKeyIdentity.as_column_ref(),
                )
                .eq(Expr::col(event::Column::Identity.as_column_ref())),
            )
            .and_where(
                Expr::col(
                    content_delete::Column::EventKeyPublicKeyType
                        .as_column_ref(),
                )
                .eq(Expr::col(event::Column::PublicKeyType.as_column_ref())),
            )
            .and_where(
                Expr::col(
                    content_delete::Column::EventKeyPublicKey.as_column_ref(),
                )
                .eq(Expr::col(event::Column::PublicKey.as_column_ref())),
            )
            .and_where(
                Expr::col(
                    content_delete::Column::EventKeySequence.as_column_ref(),
                )
                .eq(Expr::col(event::Column::Sequence.as_column_ref())),
            );
        q
    }));
    query
}

fn reaction_count_decay(positive_count: Expr, created_at: Expr) -> Expr {
    let mut func = Func::cust("reaction_count_decay");
    func = if let Some(gravity) = config::get().feeds_gravity {
        func.args([positive_count, created_at, Expr::Constant(gravity.into())])
    } else {
        func.args([positive_count, created_at])
    };
    func.into()
}

/* TODO: move to integration tests.
#[cfg(test)]
mod tests {
    use super::*;
    use entity::block;
    use chrono::DateTime;
    use polycentric_common::models::protos_v2::{EventKey, PublicKey};
    use sea_orm::prelude::DateTimeWithTimeZone;
    use sea_orm::{
        DatabaseConnection, DbBackend, MockDatabase, MockExecResult,
    };

    /// The SQL every statement the connection ran, in order.
    fn statements(db: DatabaseConnection) -> Vec<String> {
        db.into_transaction_log()
            .iter()
            .flat_map(|txn| txn.statements())
            .map(|stmt| stmt.sql.clone())
            .collect()
    }

    fn now() -> DateTimeWithTimeZone {
        DateTime::from_timestamp(0, 0).unwrap().fixed_offset()
    }

    fn event_row(identity: &str) -> event::Model {
        event::Model {
            id: 1,
            collection: COLLECTION_SOCIAL,
            identity: identity.to_string(),
            public_key_type: 1,
            public_key: vec![0xaa],
            sequence: 1,
            content_digest_type: Some(1),
            content_digest_bytes: Some(vec![1]),
            signature: vec![],
            previous_signature: vec![],
            previous_root: vec![],
            application_id: None,
            event_bytes: vec![1],
            created_at: now(),
            synced_at: now(),
        }
    }

    fn block_content(blocked: &str) -> Content {
        Content {
            content_body: Some(ContentBody::Block(Block {
                identity: blocked.to_string(),
            })),
        }
    }

    fn delete_content(target_identity: &str) -> Content {
        Content {
            content_body: Some(ContentBody::Delete(Delete {
                event_key: Some(EventKey {
                    collection: collections::SOCIAL_GRAPH,
                    identity: target_identity.to_string(),
                    signed_by: Some(PublicKey {
                        key_type: 1,
                        key: vec![0xaa],
                    }),
                    sequence: 1,
                }),
            })),
        }
    }

    #[tokio::test]
    async fn a_block_event_is_cached_in_the_block_table() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![block::Model {
                event_id: 1,
                blocker: "alice".to_string(),
                blocked: "bob".to_string(),
            }]])
            .into_connection();

        Mutation::update_cache(
            &db,
            &event_row("alice"),
            Some(&block_content("bob")),
        )
        .await
        .unwrap();

        let statements = statements(db);
        assert_eq!(statements.len(), 1);
        assert!(statements[0].contains("INSERT INTO \"block\""));
    }

    #[tokio::test]
    async fn deleting_a_graph_event_clears_both_graph_caches() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_exec_results([MockExecResult::default()])
            .into_connection();

        Mutation::update_cache(
            &db,
            &event_row("alice"),
            Some(&delete_content("alice")),
        )
        .await
        .unwrap();

        // One statement, with the two cache deletes as identically-shaped
        // CTEs hanging off a single `event_id` lookup.
        let statements = statements(db);
        assert_eq!(statements.len(), 1);
        assert!(statements[0].contains("WITH \"event_id\" AS (SELECT \"id\""));
        for (cte, table) in
            [("deleted_follows", "follow"), ("deleted_blocks", "block")]
        {
            assert!(
                statements[0].contains(&format!(
                    "\"{cte}\" AS (DELETE FROM \"{table}\" \
                     WHERE \"event_id\" IN (SELECT \"id\" FROM \"event_id\"))"
                )),
                "missing {cte} CTE in: {}",
                statements[0]
            );
        }
    }
}
*/
