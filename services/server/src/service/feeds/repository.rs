use crate::data::EventWithContentRow;
use crate::data::{Cursor, CursorFilter};
use crate::service::events::TargetEventKey;
use crate::util::db::{CONTENT_PREFIX, EVENT_PREFIX, select_model_columns};
use ::entity::{
    content_label_model as ContentLabelModel, content_model as ContentModel,
    content_post_attributed_url_model as ContentPostAttributedUrlModel,
    content_reaction_model as ContentReactionModel, event_model as EventModel,
    follow_model as FollowModel, quote_model as QuoteModel,
    reaction_model as ReactionModel,
    reaction_tally_model as ReactionTallyModel, reply_model as ReplyModel,
    repost_model as RepostModel,
};
use polycentric_common::models::collections;
use polycentric_common::models::protos_v2::SortPostsBy;
use sea_orm::{
    Condition, FromQueryResult,
    entity::prelude::*,
    sea_query::{Expr, IntoCondition, PostgresQueryBuilder, Query as SeaQuery},
    *,
};
use sea_query::query::{CommonTableExpression, WithClause};
use sea_query::{Func, SelectStatement, UnionType};
use serde::{Deserialize, Serialize};
use tonic::Status;

const FEED_COLLECTION: i16 = collections::FEED as i16;
const PROFILE_COLLECTION: i16 = collections::PROFILE as i16;

/// Type used when ordering events by the create at column.
pub type EventCreatedAt = DateTimeWithTimeZone;

// This type only exists to work around trying to get additional columns (e.g.
// the search rank) from SeaORM.
#[derive(Debug)]
pub struct ExploreEvent {
    pub event: EventModel::Model,
    pub content: ContentModel::Model,
    /// Number of positive reactions decayed over time (see the
    /// `reaction_count_decay` SQL function).
    /// Will default to zero if not returned.
    ///
    /// NOTE: This is actually a `f64`, but floating point numbers lose
    /// precision, so we let Postgres encode and decode the numeric number to a
    /// string to avoid a loss of precision.
    pub reactions: String,
}

impl TryGetableMany for ExploreEvent {
    fn try_get_many(
        res: &QueryResult,
        _: &str,
        _: &[String],
    ) -> Result<Self, TryGetError> {
        Self::try_get_many_by_index(res)
    }

    fn try_get_many_by_index(res: &QueryResult) -> Result<Self, TryGetError> {
        Ok(ExploreEvent {
            event: FromQueryResult::from_query_result(res, EVENT_PREFIX)?,
            content: FromQueryResult::from_query_result(res, CONTENT_PREFIX)?,
            // This column is only present if we order by top posts.
            reactions: res
                .try_get_by(REACTION_COUNT_COLUMN)
                .unwrap_or_else(|_| "0.0".to_owned()),
        })
    }
}

const REACTION_COUNT_COLUMN: &str = "reaction_count";

/// How to sort the post events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SortedBy {
    /// By created time.
    CreatedAt(DateTimeWithTimeZone),
    /// By the amount of reactions on it.
    ReactionCount(String),
}

impl SortedBy {
    fn matches(&self, sort_by: SortPostsBy) -> bool {
        match self {
            SortedBy::CreatedAt(_) => {
                sort_by == SortPostsBy::Default
                    || sort_by == SortPostsBy::Latest
            }
            SortedBy::ReactionCount(_) => sort_by == SortPostsBy::Top,
        }
    }

    fn as_db_value(&self) -> Expr {
        match self {
            SortedBy::CreatedAt(created_at) => Expr::from(*created_at),
            SortedBy::ReactionCount(count) => {
                Expr::cust_with_values("($1)::NUMERIC", [count])
            }
        }
    }
}

pub struct Query;

const CREATED_POSTS_ONLY: bool = true;
const ALL_INTERACTIONS: bool = false;

const OWN_POSTS: bool = true;
const NOT_OWN_POSTS: bool = false;

impl Query {
    /// Returns posts for the global Explore feed.
    pub async fn explore_feed(
        db: &DbConn,
        sort_by: SortPostsBy,
        limit: u64,
        cursor_filter: Option<&CursorFilter<SortedBy>>,
    ) -> Result<Vec<ExploreEvent>, Status> {
        Query::explore_posts(
            db,
            None,
            CREATED_POSTS_ONLY,
            OWN_POSTS,
            sort_by,
            limit,
            cursor_filter,
        )
        .await
    }

    /// Returns posts for the Following feed.
    pub async fn following_feed(
        db: &DbConn,
        for_identity: &str,
        sort_by: SortPostsBy,
        limit: u64,
        cursor_filter: Option<&CursorFilter<SortedBy>>,
    ) -> Result<Vec<ExploreEvent>, Status> {
        Query::explore_posts(
            db,
            Some(for_identity),
            CREATED_POSTS_ONLY,
            OWN_POSTS,
            sort_by,
            limit,
            cursor_filter,
        )
        .await
    }

    /// Returns posts for the Recommended / For You feed.
    pub async fn recommended_feed(
        db: &DbConn,
        for_identity: &str,
        sort_by: SortPostsBy,
        limit: u64,
        cursor_filter: Option<&CursorFilter<SortedBy>>,
    ) -> Result<Vec<ExploreEvent>, Status> {
        Query::explore_posts(
            db,
            Some(for_identity),
            ALL_INTERACTIONS,
            NOT_OWN_POSTS,
            sort_by,
            limit,
            cursor_filter,
        )
        .await
    }

    /// List post events for an explore feed.
    ///
    /// If `for_identity` is empty this will return the global Explore feed,
    /// otherwise a personal Following feed.
    ///
    /// If `posts_created_only` is true only posts created by an identity
    /// `for_identity` is following will be shown. If it's false any interaction
    /// (reaction, repost, etc.) by a followee will include the post.
    async fn explore_posts(
        db: &DbConn,
        for_identity: Option<&str>,
        posts_created_only: bool,
        include_own_posts: bool,
        sort_by: SortPostsBy,
        limit: u64,
        cursor_filter: Option<&CursorFilter<SortedBy>>,
    ) -> Result<Vec<ExploreEvent>, Status> {
        let cursor_filter =
            cursor_filter.unwrap_or(&CursorFilter::Forward(Cursor::Start));

        let mut query = EventModel::Entity::find().select_only();
        query = select_model_columns(
            query,
            EVENT_PREFIX,
            EventModel::Column::iter(),
        );
        query = select_model_columns(
            query,
            CONTENT_PREFIX,
            ContentModel::Column::iter(),
        );
        query = query.join(JoinType::InnerJoin, content_join()).filter(
            Expr::col(EventModel::Column::Collection.as_column_ref())
                .eq(Expr::Constant(collections::FEED.into())),
        );

        if let Some(for_identity) = for_identity {
            // List of identities the `for_identity` is following and
            // themselves.
            let mut following = SelectStatement::new();
            following
                .column(FollowModel::Column::Followee)
                .from(FollowModel::Entity)
                .and_where(
                    Expr::col((
                        FollowModel::Entity,
                        FollowModel::Column::Follower,
                    ))
                    .eq(for_identity),
                );
            if include_own_posts {
                following.union(UnionType::All, {
                    let mut q = SelectStatement::new();
                    q.expr(Expr::value(for_identity));
                    q
                });
            }

            const FOLLOWING_TABLE: &str = "following";
            QuerySelect::query(&mut query).with_cte({
                let mut c = WithClause::new();
                let mut cte = CommonTableExpression::new();
                cte.table_name(FOLLOWING_TABLE).query(following);
                c.recursive(false).cte(cte);
                c
            });

            let mut select_followee = SelectStatement::new();
            select_followee
                .column(FollowModel::Column::Followee)
                .from(FOLLOWING_TABLE);

            query = query.filter({
                let mut condition = Condition::any()
                    // Created by an identity the `for_identity` is following.
                    .add(
                        EventModel::Column::Identity
                            .in_subquery(select_followee.clone()),
                    );

                if !posts_created_only {
                    // Include additional interactions.
                    condition = condition
                        // Reacted on by an identity the `for_identity` is following.
                        .add(EventModel::Column::Id.in_subquery({
                            let mut q = SelectStatement::new();
                            q.column(ReactionModel::Column::OnPost)
                                .from(ReactionModel::Entity)
                                .and_where(
                                    ReactionModel::Column::Identity
                                        .in_subquery(select_followee.clone()),
                                );
                            q
                        }))
                        // Reposted by an identity the `for_identity` is following.
                        .add(EventModel::Column::Id.in_subquery({
                            let mut q = SelectStatement::new();
                            q.column(RepostModel::Column::Post)
                                .from(RepostModel::Entity)
                                .and_where(
                                    RepostModel::Column::Identity
                                        .in_subquery(select_followee.clone()),
                                );
                            q
                        }))
                        // Quoted by an identity the `for_identity` is following.
                        .add(EventModel::Column::Id.in_subquery({
                            let mut q = SelectStatement::new();
                            q.column(QuoteModel::Column::Post)
                                .from(QuoteModel::Entity)
                                .and_where(
                                    QuoteModel::Column::Identity
                                        .in_subquery(select_followee.clone()),
                                );
                            q
                        }))
                        // Replied to by an identity the `for_identity` is following.
                        .add(EventModel::Column::Id.in_subquery({
                            let mut q = SelectStatement::new();
                            q.column(ReplyModel::Column::Post)
                                .from(ReplyModel::Entity)
                                .and_where(
                                    ReplyModel::Column::Identity
                                        .in_subquery(select_followee),
                                );
                            q
                        }))
                }

                if !include_own_posts {
                    // Explicitly exclude any posts made by the user themselves.
                    condition = Condition::all()
                        .add(EventModel::Column::Identity.ne(for_identity))
                        .add(condition);
                }

                condition
            });
        }

        match sort_by {
            SortPostsBy::Default | SortPostsBy::Latest => {}
            SortPostsBy::Top => {
                QuerySelect::query(&mut query)
                    .inner_join(
                        ReactionTallyModel::Entity,
                        ReactionTallyModel::Relation::EventModel.def().rev(),
                    )
                    // We can't decode numerics as we don't have a type for it,
                    // so we have to use floats, but those lose precision, so
                    // use a string instead.
                    .expr_as(
                        Func::cast_as(
                            Expr::col(
                                ReactionTallyModel::Column::DecayedCount
                                    .as_column_ref(),
                            ),
                            "TEXT",
                        ),
                        REACTION_COUNT_COLUMN,
                    )
                    // Filter out posts that aren't relevant (anymore).
                    // Matches the `reaction_tally_decayed_count` index.
                    .cond_where(
                        Expr::col(
                            ReactionTallyModel::Column::DecayedCount
                                .as_column_ref(),
                        )
                        .gt(Expr::Constant(0.0.into())),
                    );
            }
        }

        // NOTE: SeaORM cursor only works with one of the entities used, but we
        // need to order/filter etc. by the tally, so we can't use it.
        let order_column = sort_posts_by_column(sort_by);
        QueryOrder::query(&mut query)
            .order_by_expr(order_column.clone(), Order::Desc)
            .order_by_expr(
                Expr::col(EventModel::Column::Id.as_column_ref()),
                Order::Desc,
            );

        match cursor_filter {
            CursorFilter::Forward(cur) => match cur {
                Cursor::Start => { /* No filtering. */ }
                Cursor::Mid(marker) => {
                    if !marker.sorted_by.matches(sort_by) {
                        return Err(Status::internal(
                            "wrong combination of sort_by and pagination parameters",
                        ));
                    }
                    query = query.filter(
                        Expr::tuple([
                            order_column,
                            Expr::col(EventModel::Column::Id.as_column_ref()),
                        ])
                        .lt(Expr::tuple([
                            marker.sorted_by.as_db_value(),
                            Expr::from(marker.event_id),
                        ])),
                    );
                }
                Cursor::End => return Ok(Vec::new()),
            },
            CursorFilter::Backward(cur) => match cur {
                Cursor::Start => return Ok(Vec::new()),
                Cursor::Mid(marker) => {
                    if !marker.sorted_by.matches(sort_by) {
                        return Err(Status::internal(
                            "wrong combination of sort_by and pagination parameters",
                        ));
                    }
                    query = query.filter(
                        Expr::tuple([
                            order_column,
                            Expr::col(EventModel::Column::Id.as_column_ref()),
                        ])
                        .gt(Expr::tuple([
                            marker.sorted_by.as_db_value(),
                            Expr::from(marker.event_id),
                        ])),
                    );
                }
                Cursor::End => { /* No filtering. */ }
            },
        }
        query = query.limit(limit + 1); // + 1 for pagination.

        query.into_tuple().all(db).await.map_err(|err| {
            tracing::warn!(error = %err, "failed to list feed events");
            Status::internal("internal server error")
        })
    }

    /// List events restricted to events authored by any of `identities`.
    /// Short-circuits with an empty Vec when the identity list is empty.
    pub async fn list_feed_events_by_identities(
        db: &DbConn,
        identities: Vec<String>,
        limit: u64,
        cursor_filter: &Option<CursorFilter<EventCreatedAt>>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        Self::do_list_feed_events(
            db,
            limit,
            Some(identities),
            None,
            cursor_filter,
        )
        .await
    }

    /// List events restricted to Feed posts attributed to `url` (via
    /// `Post.attributed_to[].link`). "Attributed to a URL" means an exact URL
    /// match, ignoring the other Link metadata.
    /// Short-circuits with an empty Vec when `url` is empty.
    pub async fn list_feed_events_by_attributed_url(
        db: &DbConn,
        url: String,
        limit: u64,
        cursor_filter: &Option<CursorFilter<EventCreatedAt>>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        if url.is_empty() {
            return Ok(Vec::new());
        }
        Self::do_list_feed_events(db, limit, None, Some(url), cursor_filter)
            .await
    }

    async fn do_list_feed_events(
        db: &DbConn,
        limit: u64,
        only_identities: Option<Vec<String>>,
        only_attributed_url: Option<String>,
        cursor_filter: &Option<CursorFilter<EventCreatedAt>>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        let cursor_filter = cursor_filter
            .as_ref()
            .unwrap_or(&CursorFilter::Forward(Cursor::Start));

        let mut query = EventModel::Entity::find()
            .select_also(ContentModel::Entity)
            .join(JoinType::LeftJoin, content_join())
            .filter(EventModel::Column::Collection.eq(FEED_COLLECTION));

        if let Some(identities) = only_identities {
            if identities.is_empty() {
                return Ok(Vec::new());
            }

            query =
                query.filter(EventModel::Column::Identity.is_in(identities));
        }

        if let Some(url) = only_attributed_url {
            // Join content → content_post_attributed_url on content.id and
            // keep only events whose content is attributed to `url`.
            query = query
                .join(JoinType::InnerJoin, attributed_url_join())
                .filter(ContentPostAttributedUrlModel::Column::Url.eq(url));
        }

        let columns = (EventModel::Column::CreatedAt, EventModel::Column::Id);
        let mut sea_cursor = query.cursor_by(columns);
        sea_cursor.desc();

        match cursor_filter {
            CursorFilter::Forward(cur) => {
                match cur {
                    Cursor::Start => {}
                    Cursor::Mid(marker) => {
                        sea_cursor.after(marker.values());
                    }
                    Cursor::End => return Ok(vec![]),
                }

                sea_cursor.first(limit);
            }
            CursorFilter::Backward(cur) => {
                match cur {
                    Cursor::Start => return Ok(vec![]),
                    Cursor::Mid(marker) => {
                        sea_cursor.before(marker.values());
                    }
                    Cursor::End => {}
                }
                sea_cursor.last(limit);
            }
        }

        sea_cursor.all(db).await
    }

    /// Bulk-fetch events (with joined content) by their EventKey
    /// tuples. Keys missing a `signed_by` are skipped. Used to hydrate
    /// referenced posts (quote / repost targets) as `event_hints`.
    pub async fn list_events_by_keys(
        db: &DbConn,
        keys: &[crate::service::proto::EventKey],
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        let mut filter = Condition::any();
        let mut any_added = false;
        for key in keys {
            let Some(signed_by) = key.signed_by.as_ref() else {
                continue;
            };
            filter = filter.add(
                Condition::all()
                    .add(
                        EventModel::Column::Collection
                            .eq(key.collection as i16),
                    )
                    .add(EventModel::Column::Identity.eq(key.identity.clone()))
                    .add(
                        EventModel::Column::PublicKeyType
                            .eq(signed_by.key_type as i16),
                    )
                    .add(
                        EventModel::Column::PublicKey.eq(signed_by.key.clone()),
                    )
                    .add(EventModel::Column::Sequence.eq(key.sequence as i64)),
            );
            any_added = true;
        }
        if !any_added {
            return Ok(Vec::new());
        }

        EventModel::Entity::find()
            .select_also(ContentModel::Entity)
            .join(JoinType::LeftJoin, content_join())
            .filter(filter)
            .all(db)
            .await
    }

    /// Fetch label events that target any of `keys`. Only labels from
    /// the trusted moderator are returned, using a join through
    /// `content_label` → `content` → `events` to check the label
    /// author's identity. Returns empty when no moderator is configured.
    pub async fn list_labels_for_event_keys(
        db: &DbConn,
        keys: &[TargetEventKey],
        trusted_moderator: Option<&str>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        let Some(moderator) = trusted_moderator else {
            return Ok(Vec::new());
        };

        if keys.is_empty() {
            return Ok(Vec::new());
        }

        // Create filtering clause for the relevant event keys
        let mut event_key_filter = Condition::any();
        for key in keys {
            event_key_filter = event_key_filter.add(
                Condition::all()
                    .add(
                        ContentLabelModel::Column::EventKeyCollection
                            .eq(key.collection),
                    )
                    .add(
                        ContentLabelModel::Column::EventKeyIdentity
                            .eq(key.identity.clone()),
                    )
                    .add(
                        ContentLabelModel::Column::EventKeyPublicKeyType
                            .eq(key.public_key_type),
                    )
                    .add(
                        ContentLabelModel::Column::EventKeyPublicKey
                            .eq(key.public_key.clone()),
                    )
                    .add(
                        ContentLabelModel::Column::EventKeySequence
                            .eq(key.sequence),
                    ),
            );
        }

        // Join label information with the identity that signed the label,
        // then filter based on the event key filter constructed above. Also,
        // only select events from the trusted moderator identity
        let mut query = SeaQuery::select();
        query
            .column((
                ContentLabelModel::Entity,
                ContentLabelModel::Column::ContentId,
            ))
            .from(ContentLabelModel::Entity)
            .inner_join(
                ContentModel::Entity,
                Expr::col((
                    ContentLabelModel::Entity,
                    ContentLabelModel::Column::ContentId,
                ))
                .equals((ContentModel::Entity, ContentModel::Column::Id)),
            )
            .inner_join(
                EventModel::Entity,
                Expr::col((
                    EventModel::Entity,
                    EventModel::Column::ContentDigestType,
                ))
                .equals((
                    ContentModel::Entity,
                    ContentModel::Column::DigestType,
                ))
                .and(
                    Expr::col((
                        EventModel::Entity,
                        EventModel::Column::ContentDigestBytes,
                    ))
                    .equals((
                        ContentModel::Entity,
                        ContentModel::Column::DigestBytes,
                    )),
                ),
            )
            .and_where(
                Expr::col((EventModel::Entity, EventModel::Column::Identity))
                    .eq(moderator.to_owned()),
            )
            .and_where(event_key_filter.into());

        // Build the query
        let (sql, values) = query.build(PostgresQueryBuilder);
        let stmt = Statement::from_sql_and_values(
            db.get_database_backend(),
            &sql,
            values,
        );

        // Collect the content IDs that match the query
        #[derive(Debug, FromQueryResult)]
        struct LabelContentId {
            content_id: i64,
        }
        let label_ids: Vec<LabelContentId> =
            LabelContentId::find_by_statement(stmt).all(db).await?;
        let mut content_ids: Vec<i64> =
            label_ids.into_iter().map(|r| r.content_id).collect();
        content_ids.sort_unstable();
        content_ids.dedup();

        if content_ids.is_empty() {
            return Ok(Vec::new());
        }

        // Return event entities that match the content IDs
        EventModel::Entity::find()
            .select_also(ContentModel::Entity)
            .join(JoinType::LeftJoin, content_join())
            .filter(ContentModel::Column::Id.is_in(content_ids))
            .all(db)
            .await
    }

    /// Look up a single event (with joined content) by its EventKey tuple.
    pub async fn find_event_by_key(
        db: &DbConn,
        collection: i16,
        identity: &str,
        public_key_type: i16,
        public_key: Vec<u8>,
        sequence: i64,
    ) -> Result<Option<EventWithContentRow>, DbErr> {
        EventModel::Entity::find()
            .select_also(ContentModel::Entity)
            .join(JoinType::LeftJoin, content_join())
            .filter(EventModel::Column::Collection.eq(collection))
            .filter(EventModel::Column::Identity.eq(identity))
            .filter(EventModel::Column::PublicKeyType.eq(public_key_type))
            .filter(EventModel::Column::PublicKey.eq(public_key))
            .filter(EventModel::Column::Sequence.eq(sequence))
            .one(db)
            .await
    }

    /// Return the latest PROFILE event (highest `sequence`) per
    /// identity for each of `identities`. Used as `event_hints` on
    /// feed/thread responses so clients can populate author profiles
    /// without a follow-up round-trip.
    pub async fn list_latest_profiles_for_identities(
        db: &DbConn,
        identities: Vec<String>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        if identities.is_empty() {
            return Ok(Vec::new());
        }
        let rows = EventModel::Entity::find()
            .select_also(ContentModel::Entity)
            .join(JoinType::LeftJoin, content_join())
            .filter(EventModel::Column::Collection.eq(PROFILE_COLLECTION))
            .filter(EventModel::Column::Identity.is_in(identities))
            .order_by_desc(EventModel::Column::Sequence)
            .all(db)
            .await?;

        // Keep the first (highest-sequence) row per identity.
        let mut seen: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        let mut deduped = Vec::with_capacity(rows.len());
        for row in rows {
            if seen.insert(row.0.identity.clone()) {
                deduped.push(row);
            }
        }
        Ok(deduped)
    }

    /// Bulk-fetch event rows by primary key, joining content. Order of the
    /// returned Vec is unspecified — caller reorders against the input list.
    pub async fn list_events_by_ids(
        db: &DbConn,
        ids: Vec<i64>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        EventModel::Entity::find()
            .select_also(ContentModel::Entity)
            .join(JoinType::LeftJoin, content_join())
            .filter(EventModel::Column::Id.is_in(ids))
            .all(db)
            .await
    }

    /// Return ids (and height) of ancestors
    pub async fn list_ancestor_refs(
        db: &DbConn,
        subject_event_id: i64,
        max_height: i32,
    ) -> Result<Vec<AncestorRef>, DbErr> {
        let stmt = Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
            WITH RECURSIVE ancestor(event_id, height) AS (
                SELECT pe.id, 1
                FROM events sub_e
                INNER JOIN content sub_c
                    ON sub_c.digest_type = sub_e.content_digest_type
                    AND sub_c.digest_bytes = sub_e.content_digest_bytes
                INNER JOIN content_post sub_cp
                    ON sub_cp.content_id = sub_c.id
                INNER JOIN events pe
                    ON pe.collection = sub_cp.reply_parent_collection
                    AND pe.identity = sub_cp.reply_parent_identity
                    AND pe.public_key_type = sub_cp.reply_parent_public_key_type
                    AND pe.public_key = sub_cp.reply_parent_public_key
                    AND pe.sequence = sub_cp.reply_parent_sequence
                WHERE sub_e.id = $1

                UNION ALL

                SELECT npe.id, a.height + 1
                FROM ancestor a
                INNER JOIN events ae ON ae.id = a.event_id
                INNER JOIN content ac
                    ON ac.digest_type = ae.content_digest_type
                    AND ac.digest_bytes = ae.content_digest_bytes
                INNER JOIN content_post acp
                    ON acp.content_id = ac.id
                INNER JOIN events npe
                    ON npe.collection = acp.reply_parent_collection
                    AND npe.identity = acp.reply_parent_identity
                    AND npe.public_key_type = acp.reply_parent_public_key_type
                    AND npe.public_key = acp.reply_parent_public_key
                    AND npe.sequence = acp.reply_parent_sequence
                WHERE a.height < $2
            )
            SELECT event_id, height FROM ancestor ORDER BY height DESC
            "#,
            vec![subject_event_id.into(), max_height.into()],
        );
        AncestorRef::find_by_statement(stmt).all(db).await
    }

    /// Return every descendant of the subject as `(event_id, parent_event_id,
    /// depth)`, ordered (depth ASC, created_at DESC) so per-parent groupings
    /// come newest-first. Caller applies branching/sort/flatten.
    pub async fn list_descendant_refs(
        db: &DbConn,
        subject_event_id: i64,
        max_depth: i32,
        limit: u64,
    ) -> Result<Vec<DescendantRef>, DbErr> {
        let stmt = Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
            WITH RECURSIVE descendant(event_id, parent_event_id, depth, created_at) AS (
                SELECT reply.id, events.id, 1, reply.created_at
                FROM events
                INNER JOIN content_post ON
                        content_post.reply_parent_collection = events.collection
                    AND content_post.reply_parent_identity = events.identity
                    AND content_post.reply_parent_public_key_type = events.public_key_type
                    AND content_post.reply_parent_public_key = events.public_key
                    AND content_post.reply_parent_sequence = events.sequence
                INNER JOIN content ON content.id = content_post.content_id
                INNER JOIN events AS reply ON
                        reply.content_digest_type = content.digest_type
                    AND reply.content_digest_bytes = content.digest_bytes
                WHERE events.id = $1

                UNION ALL

                SELECT reply.id, descendant.event_id, descendant.depth + 1, reply.created_at
                FROM descendant
                INNER JOIN events ON events.id = descendant.event_id
                INNER JOIN content_post ON
                        content_post.reply_parent_collection = events.collection
                    AND content_post.reply_parent_identity = events.identity
                    AND content_post.reply_parent_public_key_type = events.public_key_type
                    AND content_post.reply_parent_public_key = events.public_key
                    AND content_post.reply_parent_sequence = events.sequence
                INNER JOIN content ON content.id = content_post.content_id
                INNER JOIN events AS reply ON
                        reply.content_digest_type = content.digest_type
                    AND reply.content_digest_bytes = content.digest_bytes
                WHERE descendant.depth < $2
            )
            SELECT event_id, parent_event_id
            FROM descendant
            ORDER BY depth ASC, created_at DESC
            LIMIT $3
            "#,
            vec![
                subject_event_id.into(),
                max_depth.into(),
                (limit as i64).into(),
            ],
        );
        DescendantRef::find_by_statement(stmt).all(db).await
    }

    /// Get up to `limit` reaction events for the target post.
    /// Fetches in order of most-recent to least-recent so that we don't fetch
    /// outdated reactions from a user that have been superseded without also
    /// getting the newest one.
    /// Optionally, filter events to only include reactions with `emoji`.
    pub async fn get_reactions(
        db: &DbConn,
        target: &TargetEventKey,
        emoji: Option<&str>,
        limit: u64,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        let mut query = EventModel::Entity::find()
            .select_also(ContentModel::Entity)
            // Include content and reaction information:
            .join(JoinType::InnerJoin, content_join())
            .join(
                JoinType::InnerJoin,
                ContentModel::Entity::belongs_to(ContentReactionModel::Entity)
                    .from(ContentModel::Column::Id)
                    .to(ContentReactionModel::Column::ContentId)
                    .into(),
            )
            // Keep only reactions targetting the requested post:
            .filter(
                ContentReactionModel::Column::EventKeyCollection
                    .eq(target.collection),
            )
            .filter(
                ContentReactionModel::Column::EventKeyIdentity
                    .eq(target.identity.clone()),
            )
            .filter(
                ContentReactionModel::Column::EventKeyPublicKeyType
                    .eq(target.public_key_type),
            )
            .filter(
                ContentReactionModel::Column::EventKeyPublicKey
                    .eq(target.public_key.clone()),
            )
            .filter(
                ContentReactionModel::Column::EventKeySequence
                    .eq(target.sequence),
            )
            // Deterministically sort by newest
            .order_by_desc(EventModel::Column::CreatedAt)
            .order_by_desc(EventModel::Column::Id);

        // TODO: this is currently buggy when a user creates a new reaction
        // without deleting the old one.
        // We may filter out the newest reaction and send back an outdated reaction.
        // With no tombstone, it will be rendered as active.
        if let Some(emoji) = emoji {
            query = query.filter(ContentReactionModel::Column::Emoji.eq(emoji));
        }

        query.limit(limit).all(db).await
    }
}

/// Relation joining a content row to its attributed-URL rows on content.id.
/// Used to filter feed events down to those attributed to a given URL.
pub(crate) fn attributed_url_join() -> RelationDef {
    ContentModel::Entity::has_many(ContentPostAttributedUrlModel::Entity)
        .from(ContentModel::Column::Id)
        .to(ContentPostAttributedUrlModel::Column::ContentId)
        .into()
}

/// Relation joining an event to its content row on (digest_type, digest_bytes).
pub(crate) fn content_join() -> RelationDef {
    EventModel::Entity::belongs_to(ContentModel::Entity)
        .from(EventModel::Column::ContentDigestType)
        .to(ContentModel::Column::DigestType)
        .on_condition(|event_tbl, content_tbl| {
            Expr::col((event_tbl, EventModel::Column::ContentDigestBytes))
                .equals((content_tbl, ContentModel::Column::DigestBytes))
                .into_condition()
        })
        .into()
}

fn sort_posts_by_column(sort_by: SortPostsBy) -> Expr {
    match sort_by {
        SortPostsBy::Default | SortPostsBy::Latest => {
            Expr::col(EventModel::Column::CreatedAt.as_column_ref())
        }
        SortPostsBy::Top => {
            Expr::col(ReactionTallyModel::Column::DecayedCount.as_column_ref())
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub struct AncestorRef {
    pub event_id: i64,
}

#[derive(Debug, FromQueryResult)]
pub struct DescendantRef {
    pub event_id: i64,
    pub parent_event_id: i64,
}
