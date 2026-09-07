use ::entity::block_model as BlockModel;
use ::entity::content_follow_model as ContentFollowModel;
use ::entity::content_model as ContentModel;
use ::entity::default_follow_suggestion_model as DefaultFollowSuggestionModel;
use ::entity::event_model as EventModel;
use ::entity::follow_model as FollowModel;
use polycentric_common::models::collections;
use prost::Message;
use sea_orm::*;
use sea_query::{
    Asterisk, ColumnRef, CommonTableExpression, Expr, Func, IntoColumnRef,
    PgFunc, SelectStatement, UnionType, WithClause,
};
use std::collections::HashSet;
use std::sync::Arc;
use tonic::Status;

use crate::data::EventWithContentRow;
use crate::data::hydration::event_identities;
use crate::data::{Cursor, CursorFilter, EventRow};
use crate::service::context::{RequestContext, ServiceContext};
use crate::service::events::{TargetEventKey, tombstone};
use crate::service::feeds::repository::{EventCreatedAt, content_join};
use crate::service::proto::Content;
use crate::service::proto::content::ContentBody;
use crate::util::db::{CONTENT_PREFIX, EVENT_PREFIX, select_model_columns};

#[derive(Debug)]
pub struct FollowSuggestionEvent {
    pub event: EventModel::Model,
    pub content: ContentModel::Model,
    pub followers: Vec<String>,
}

impl TryGetableMany for FollowSuggestionEvent {
    fn try_get_many(
        res: &QueryResult,
        _: &str,
        _: &[String],
    ) -> Result<Self, TryGetError> {
        Self::try_get_many_by_index(res)
    }

    fn try_get_many_by_index(res: &QueryResult) -> Result<Self, TryGetError> {
        Ok(FollowSuggestionEvent {
            event: FromQueryResult::from_query_result(res, EVENT_PREFIX)?,
            content: FromQueryResult::from_query_result(res, CONTENT_PREFIX)?,
            followers: TryGetable::try_get_by(res, FOLLOWERS_COLUMN)?,
        })
    }
}

impl EventRow for FollowSuggestionEvent {
    fn as_event_with_content(
        &self,
    ) -> (&EventModel::Model, Option<&ContentModel::Model>) {
        (&self.event, Some(&self.content))
    }

    fn as_event(&self) -> &EventModel::Model {
        &self.event
    }

    fn as_content(&self) -> Option<&ContentModel::Model> {
        Some(&self.content)
    }

    /// Collects all identities in the event and adds them to `identities`.
    fn collect_identities(&self, identities: &mut HashSet<String>) {
        let (event, content) = self.as_event_with_content();
        event_identities(event, content, identities);
        identities.extend(self.followers.iter().cloned());
    }
}

const FOLLOWERS_COLUMN: &str = "followers";

/// Data to sort [`FollowSuggestionEvent`].
pub type FollowSuggestionsSortedBy = i32;

pub struct Query;

impl Query {
    /// Return the list of identities that `caller` has followed,
    /// excluding any Follow event tombstoned by a *valid* Delete
    /// event.
    ///
    /// Follow → Unfollow → Follow-again resolves to "following"
    /// because the re-follow event has a fresh sequence and no
    /// valid Delete points at it.
    ///
    /// TODO: We can either cache these OR keep a follower table that we update on ingest.
    /// This current query is inefficient.
    pub async fn list_followed_identities(
        ctx: &ServiceContext,
        caller: &str,
    ) -> Result<Vec<String>, Status> {
        list_graph_targets(ctx, caller, decode_followed_identity).await
    }

    /// Identities `caller` has blocked, read from the `block` cache table.
    /// No tombstone filtering is required here: the cache only holds rows
    /// for blocks that have not been deleted.
    pub async fn list_blocked_identities(
        ctx: &ServiceContext,
        caller: &str,
    ) -> Result<Vec<String>, Status> {
        BlockModel::Entity::find()
            .select_only()
            .column(BlockModel::Column::Blocked)
            .distinct()
            .filter(BlockModel::Column::Blocker.eq(caller))
            .into_tuple::<String>()
            .all(&ctx.ro_db)
            .await
            .map_err(map_db_err)
    }

    /// [`Query::list_blocked_identities`] as a deduplicated set, for
    /// filtering the identities a response may carry.
    pub async fn blocked_set(
        ctx: &ServiceContext,
        identity: &str,
    ) -> Result<Arc<HashSet<String>>, Status> {
        Ok(Arc::new(
            Self::list_blocked_identities(ctx, identity)
                .await?
                .into_iter()
                .collect(),
        ))
    }

    /// [`Query::blocked_set`] for the caller of a request. Empty when the
    /// request arrived unauthenticated, as there is then no caller whose
    /// blocks could apply.
    pub async fn blocked_set_for_caller(
        ctx: &RequestContext<'_>,
    ) -> Result<Arc<HashSet<String>>, Status> {
        match ctx.caller {
            Some(caller) => Self::blocked_set(ctx.service, caller).await,
            None => Ok(Arc::new(HashSet::new())),
        }
    }

    /// The subset of `potential_blockers` that block the `blocked` identity.
    ///
    /// TODO: passing `potential_blockers` is required because the only index
    /// on the blocked cache is `(blocker, blocked)`. Eventually, we should
    /// add index such that we can efficiently query only the blocked identity
    /// and get all blockers.
    pub async fn identities_blocking<'a, I>(
        ctx: &ServiceContext,
        potential_blockers: I,
        blocked: &str,
    ) -> Result<HashSet<String>, Status>
    where
        I: IntoIterator<Item = &'a str>,
    {
        let potential_blockers: Vec<String> =
            potential_blockers.into_iter().map(str::to_owned).collect();
        if potential_blockers.is_empty() {
            return Ok(HashSet::new());
        }

        BlockModel::Entity::find()
            .select_only()
            .column(BlockModel::Column::Blocker)
            .distinct()
            .filter(BlockModel::Column::Blocked.eq(blocked))
            .filter(
                Expr::col((BlockModel::Entity, BlockModel::Column::Blocker))
                    .eq(PgFunc::any(potential_blockers)),
            )
            .into_tuple::<String>()
            .all(&ctx.ro_db)
            .await
            .map(HashSet::from_iter)
            .map_err(map_db_err)
    }

    pub async fn blocks_identity(
        ctx: &ServiceContext,
        blocker: &str,
        blocked: &str,
    ) -> Result<bool, Status> {
        let row = BlockModel::Entity::find()
            .filter(BlockModel::Column::Blocker.eq(blocker))
            .filter(BlockModel::Column::Blocked.eq(blocked))
            .one(&ctx.ro_db)
            .await
            .map_err(map_db_err)?;

        Ok(row.is_some())
    }

    /// Count of distinct identities `identity` follows (tombstone-aware).
    ///
    /// TODO: same inefficiency as `list_followed_identities` — a
    /// maintained counter would avoid scanning the graph rows.
    pub async fn count_following(
        ctx: &ServiceContext,
        identity: &str,
    ) -> Result<u64, Status> {
        Ok(Self::list_followed_identities(ctx, identity).await?.len() as u64)
    }

    /// Count of distinct identities following `identity`
    /// (tombstone-aware).
    pub async fn count_followers(
        ctx: &ServiceContext,
        identity: &str,
    ) -> Result<u64, Status> {
        let rows: Vec<EventWithContentRow> = follow_events_query()
            .filter(ContentFollowModel::Column::IdentityId.eq(identity))
            .all(&ctx.ro_db)
            .await
            .map_err(map_db_err)?;

        let keys: Vec<TargetEventKey> = rows
            .iter()
            .map(|(event, _)| TargetEventKey::of(event))
            .collect();
        let raw_tombstones =
            tombstone::list_tombstones_for_event_keys(&ctx.ro_db, &keys)
                .await
                .map_err(map_db_err)?;
        let valid_tombstones =
            tombstone::validate_tombstones(ctx, raw_tombstones).await?;

        let followers: HashSet<&str> = rows
            .iter()
            .filter(|(event, _)| {
                !valid_tombstones.contains_key(&TargetEventKey::of(event))
            })
            .map(|(event, _)| event.identity.as_str())
            .collect();
        Ok(followers.len() as u64)
    }

    /// Follow events authored by `identity` — who they follow. Newest
    /// first, keyset-paginated, tombstones NOT yet filtered.
    pub async fn list_following_events(
        db: &DbConn,
        identity: &str,
        limit: u32,
        cursor_filter: Option<&CursorFilter<EventCreatedAt>>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        let query = follow_events_query()
            .filter(EventModel::Column::Identity.eq(identity));
        page_follow_events(db, query, limit, cursor_filter).await
    }

    /// Follow events targeting `identity` — who follows them. Newest
    /// first, keyset-paginated, tombstones NOT yet filtered.
    pub async fn list_followers_events(
        db: &DbConn,
        identity: &str,
        limit: u32,
        cursor_filter: Option<&CursorFilter<EventCreatedAt>>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        let query = follow_events_query()
            .filter(ContentFollowModel::Column::IdentityId.eq(identity));
        page_follow_events(db, query, limit, cursor_filter).await
    }

    pub async fn suggest_follow(
        db: &DbConn,
        identity: &str,
        cursor_filter: Option<&CursorFilter<FollowSuggestionsSortedBy>>,
        limit: u32,
    ) -> Result<Vec<FollowSuggestionEvent>, DbErr> {
        let cursor_filter =
            cursor_filter.unwrap_or(&CursorFilter::Forward(Cursor::Start));

        // List of identities the `identity` is following.
        const FOLLOWING_TABLE: &str = "following";
        let mut following = SelectStatement::new();
        following
            .column(FollowModel::Column::Followee)
            .from(FollowModel::Entity)
            .and_where(FollowModel::Column::Follower.eq(identity));
        let mut select_following = SelectStatement::new();
        select_following
            .column(FollowModel::Column::Followee)
            .from(FOLLOWING_TABLE);
        const SUGGESTIONS_TABLE: &str = "suggestions";
        // List of identities that are followed by identities that `identity`
        // follows. Are you following this? In other words if you follow Alice,
        // and Alice follows Bob, this list will include Bob.
        let mut followee_suggestions = SelectStatement::new();
        followee_suggestions
            .column(FollowModel::Column::Followee)
            // NOTE: the tuple (followee, follower) is not unique in the follow
            // table because the user can create multiple valid events that
            // follow the same identity. As a result we can return duplicate
            // identities here.
            //
            // If this becomes an issue we can fix this by calling
            // `array_agg(DISTINCT followers)`, except currently SeaORM doesn't
            // allow use to do this easily as it doesn't expose
            // `FunctionCall::arg_with` or a similar function to set DISTINCT in
            // the function call.
            .expr_as(
                PgFunc::array_agg(Expr::col(FollowModel::Column::Follower)),
                FOLLOWERS_COLUMN,
            )
            .from(FollowModel::Entity)
            .and_where(
                FollowModel::Column::Follower
                    .in_subquery(select_following.clone()),
            )
            .group_by_col(FollowModel::Column::Followee);
        // All default suggestions.
        let mut default_suggestions = SelectStatement::new();
        default_suggestions
            .column(DefaultFollowSuggestionModel::Column::Identity)
            // By using an empty array for the followers we ensure the default
            // suggestions always come last.
            .expr_as(Expr::cust("ARRAY[]::TEXT[]"), FOLLOWERS_COLUMN)
            .from(DefaultFollowSuggestionModel::Entity);
        // Combined followee and default suggestions.
        let mut suggestions = SelectStatement::new();
        suggestions
            .column(FollowModel::Column::Followee)
            .column(FOLLOWERS_COLUMN)
            .from_subquery(
                {
                    let mut q = SelectStatement::new();
                    q.column(FollowModel::Column::Followee)
                        .column(FOLLOWERS_COLUMN)
                        .from_subquery(
                            followee_suggestions,
                            "followee_suggestions",
                        )
                        .union(UnionType::All, default_suggestions);
                    q
                },
                "all_suggestions",
            )
            // Don't suggest ourselves.
            .and_where(
                Expr::col(FollowModel::Column::Followee.into_column_ref())
                    .ne(identity),
            )
            // Don't suggest identities the identity is already following.
            .and_where(
                Expr::col(FollowModel::Column::Followee.into_column_ref())
                    .not_in_subquery(select_following),
            );

        // The latest identitiy events based on the follow suggestions.
        let mut identity_events = SelectStatement::new();
        identity_events
            .distinct_on([EventModel::Column::Identity.as_column_ref()])
            .expr(Expr::col(ColumnRef::Asterisk(Some(
                EventModel::Entity.into(),
            ))))
            .expr_as(
                Expr::col((SUGGESTIONS_TABLE, FOLLOWERS_COLUMN)),
                FOLLOWERS_COLUMN,
            )
            .from(EventModel::Entity)
            .inner_join(
                SUGGESTIONS_TABLE,
                Expr::col(EventModel::Column::Identity.as_column_ref()).eq(
                    Expr::col((
                        SUGGESTIONS_TABLE,
                        FollowModel::Column::Followee,
                    )),
                ),
            )
            .cond_where(
                Expr::col(EventModel::Column::Collection.as_column_ref())
                    .eq(Expr::Constant(collections::IDENTITY.into())),
            )
            .order_by(EventModel::Column::Identity, Order::Asc)
            .order_by(EventModel::Column::Sequence, Order::Desc);

        let mut query = EventModel::Entity::find().select_only();
        QuerySelect::query(&mut query).with_cte({
            let mut c = WithClause::new();
            let mut following_cte = CommonTableExpression::new();
            following_cte.table_name(FOLLOWING_TABLE).query(following);
            let mut suggestions_cte = CommonTableExpression::new();
            suggestions_cte
                .table_name(SUGGESTIONS_TABLE)
                .query(suggestions);
            let mut identity_events_cte = CommonTableExpression::new();
            identity_events_cte
                // NOTE: overwriting table name so that we don't have to rename
                // the selects below.
                .table_name(EventModel::Entity)
                .query(identity_events);
            c.recursive(false)
                .cte(following_cte)
                .cte(suggestions_cte)
                .cte(identity_events_cte);
            c
        });
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
        query = query.join(JoinType::InnerJoin, content_join());
        QuerySelect::query(&mut query).expr_as(
            Expr::col((EventModel::Entity, FOLLOWERS_COLUMN)),
            FOLLOWERS_COLUMN,
        );

        // NOTE: this ordering isn't very stable, as users following and
        // unfollowing users it will break this ordering between calls.
        //
        // COALESCE: array_length of an empty array is NULL, which would sort
        // default suggestions (empty followers) first under DESC and make
        // every cursor tuple comparison against them NULL (never matching).
        // Mapping to 0 keeps them last and paginatable.
        let order_column = Expr::from(Func::coalesce([
            Func::cust("array_length")
                .arg(Expr::col((EventModel::Entity, FOLLOWERS_COLUMN)))
                .arg(Expr::Constant(1.into()))
                .into(),
            Expr::Constant(0.into()),
        ]));
        // Both columns DESC: the cursor filters below compare the whole
        // (order, id) tuple with </>, which is only correct when the sort
        // direction is uniform. With id ASC, pages of tied follower counts
        // would repeat forever.
        QuerySelect::query(&mut query)
            .order_by_expr(order_column.clone(), Order::Desc)
            .order_by_expr(
                Expr::col(EventModel::Column::Id.as_column_ref()),
                Order::Desc,
            );

        match cursor_filter {
            CursorFilter::Forward(cur) => match cur {
                Cursor::Start => { /* No filtering. */ }
                Cursor::Mid(marker) => {
                    query = query.filter(
                        Expr::tuple([
                            order_column,
                            Expr::col(EventModel::Column::Id.as_column_ref()),
                        ])
                        .lt(Expr::tuple([
                            Expr::from(marker.sorted_by),
                            Expr::from(marker.event_id),
                        ])),
                    );
                }
                Cursor::End => return Ok(Vec::new()),
            },
            CursorFilter::Backward(cur) => match cur {
                Cursor::Start => return Ok(Vec::new()),
                Cursor::Mid(marker) => {
                    query = query.filter(
                        Expr::tuple([
                            order_column,
                            Expr::col(EventModel::Column::Id.as_column_ref()),
                        ])
                        .gt(Expr::tuple([
                            Expr::from(marker.sorted_by),
                            Expr::from(marker.event_id),
                        ])),
                    );
                }
                Cursor::End => { /* No filtering. */ }
            },
        }
        query = query.limit(Some((limit + 1).into())); // + 1 for pagination.

        query.into_tuple().all(db).await
    }

    /// `follows` is (followee, follower).
    pub async fn follow_events(
        db: &DbConn,
        // NOTE: we should use an iterator here, but that triggers a "known
        // limitation" in the compiler:
        // > lifetime bound not satisfied
        // > note: this is a known limitation that will be removed in the future
        // > (see issue #100014 <https://github.com/rust-lang/rust/issues/100013>
        // > for more information)
        //follows: impl Iterator<Item = (&str, &str)>,
        follows: Vec<(&str, &str)>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        if follows.is_empty() {
            return Ok(Vec::new());
        }

        let mut values = SelectStatement::new();
        values
            .expr(Expr::col(Asterisk))
            .from_values(follows, "follows");

        EventModel::Entity::find()
            .select_also(ContentModel::Entity)
            .join(JoinType::InnerJoin, content_join())
            .join(
                JoinType::InnerJoin,
                FollowModel::Relation::EventModel.def().rev(),
            )
            .filter(
                EventModel::Column::Collection.eq(collections::SOCIAL_GRAPH),
            )
            .filter(
                Expr::tuple([
                    Expr::col(FollowModel::Column::Followee),
                    Expr::col(FollowModel::Column::Follower),
                ])
                .eq(Expr::any(values)),
            )
            .all(db)
            .await
    }
}

/// Obtains the targets of graph events authored by `caller`. The `extract`
/// function filters for specific types of graph events.
async fn list_graph_targets(
    ctx: &ServiceContext,
    caller: &str,
    extract: fn(&ContentModel::Model) -> Option<String>,
) -> Result<Vec<String>, Status> {
    let rows: Vec<EventWithContentRow> = EventModel::Entity::find()
        .select_also(ContentModel::Entity)
        .join(JoinType::InnerJoin, content_join())
        .filter(EventModel::Column::Collection.eq(collections::SOCIAL_GRAPH))
        .filter(EventModel::Column::Identity.eq(caller))
        .all(&ctx.ro_db)
        .await
        .map_err(map_db_err)?;

    let keys: Vec<TargetEventKey> = rows
        .iter()
        .map(|(event, _)| TargetEventKey::of(event))
        .collect();
    let raw_tombstones =
        tombstone::list_tombstones_for_event_keys(&ctx.ro_db, &keys)
            .await
            .map_err(map_db_err)?;
    let valid_tombstones =
        tombstone::validate_tombstones(ctx, raw_tombstones).await?;

    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<String> = Vec::new();
    for (event, content) in rows {
        let key = TargetEventKey::of(&event);
        if valid_tombstones.contains_key(&key) {
            continue;
        }
        let Some(content) = content else { continue };
        if let Some(identity) = extract(&content)
            && seen.insert(identity.clone())
        {
            result.push(identity);
        }
    }
    Ok(result)
}

/// Graph events joined to their Follow content. The inner joins keep
/// Delete (unfollow) events out of the page.
fn follow_events_query() -> SelectTwo<EventModel::Entity, ContentModel::Entity>
{
    EventModel::Entity::find()
        .select_also(ContentModel::Entity)
        .join(JoinType::InnerJoin, content_join())
        .join(JoinType::InnerJoin, follow_join())
        .filter(EventModel::Column::Collection.eq(collections::SOCIAL_GRAPH))
}

/// Relation joining a content row to its Follow row.
fn follow_join() -> RelationDef {
    ContentModel::Entity::belongs_to(ContentFollowModel::Entity)
        .from(ContentModel::Column::Id)
        .to(ContentFollowModel::Column::ContentId)
        .into()
}

/// Apply the (created_at, id) keyset cursor and fetch, newest first.
/// Mirrors the feeds repository's pagination.
async fn page_follow_events(
    db: &DbConn,
    query: SelectTwo<EventModel::Entity, ContentModel::Entity>,
    limit: u32,
    cursor_filter: Option<&CursorFilter<EventCreatedAt>>,
) -> Result<Vec<EventWithContentRow>, DbErr> {
    let cursor_filter =
        cursor_filter.unwrap_or(&CursorFilter::Forward(Cursor::Start));

    let mut sea_cursor = query
        .cursor_by((EventModel::Column::CreatedAt, EventModel::Column::Id));
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
            sea_cursor.first(limit.into());
        }
        CursorFilter::Backward(cur) => {
            match cur {
                Cursor::Start => return Ok(vec![]),
                Cursor::Mid(marker) => {
                    sea_cursor.before(marker.values());
                }
                Cursor::End => {}
            }
            sea_cursor.last(limit.into());
        }
    }

    sea_cursor.all(db).await
}

/// Identity of the target of a Follow event, decoded from the
/// parent content row.
fn decode_followed_identity(
    content: &::entity::content_model::Model,
) -> Option<String> {
    let decoded = Content::decode(content.serialized_bytes.as_slice()).ok()?;
    match decoded.content_body? {
        ContentBody::Follow(follow) => {
            Some(follow.identity).filter(|s| !s.is_empty())
        }
        _ => None,
    }
}

fn map_db_err(e: sea_orm::DbErr) -> Status {
    tracing::error!(error = %e, "graph repository db error");
    Status::internal("internal server error")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::proto::{Block, Follow};
    use chrono::Utc;
    use sea_orm::prelude::DateTimeWithTimeZone;
    use sea_orm::{
        DatabaseConnection, DbBackend, MockDatabase, MockRow, Value,
    };
    use std::collections::BTreeMap;
    use std::sync::Arc;

    async fn ctx(db: DatabaseConnection) -> Arc<ServiceContext> {
        let kafka_producer = common_kafka::build_producer()
            .await
            .expect("failed to build Kafka producer");
        ServiceContext::new(db, kafka_producer)
    }

    fn now() -> DateTimeWithTimeZone {
        Utc::now().fixed_offset()
    }

    fn event_row(id: i64, identity: &str, sequence: i64) -> EventModel::Model {
        EventModel::Model {
            id,
            collection: collections::SOCIAL_GRAPH as _,
            identity: identity.to_string(),
            public_key_type: 1,
            public_key: vec![0xaa],
            sequence,
            content_digest_type: Some(1),
            content_digest_bytes: Some(vec![id as u8]),
            signature: vec![],
            previous_signature: vec![],
            previous_root: vec![],
            application_id: None,
            event_bytes: vec![id as u8],
            created_at: now(),
            synced_at: now(),
        }
    }

    fn follow_row(id: i64, target: &str) -> ContentModel::Model {
        let content = Content {
            content_body: Some(ContentBody::Follow(Follow {
                identity: target.to_string(),
            })),
        };
        ContentModel::Model {
            id,
            digest_type: 1,
            digest_bytes: vec![id as u8],
            serialized_bytes: content.encode_to_vec(),
            synced_at: now(),
        }
    }

    fn block_content_row(id: i64, target: &str) -> ContentModel::Model {
        let content = Content {
            content_body: Some(ContentBody::Block(Block {
                identity: target.to_string(),
            })),
        };
        ContentModel::Model {
            id,
            digest_type: 1,
            digest_bytes: vec![id as u8],
            serialized_bytes: content.encode_to_vec(),
            synced_at: now(),
        }
    }

    fn block_row(
        event_id: i64,
        blocker: &str,
        blocked: &str,
    ) -> BlockModel::Model {
        BlockModel::Model {
            event_id,
            blocker: blocker.to_string(),
            blocked: blocked.to_string(),
        }
    }

    /// The single `blocked` column [`Query::list_blocked_identities`] selects.
    fn blocked_column_row(blocked: &str) -> BTreeMap<String, Value> {
        BTreeMap::from([("blocked".to_string(), Value::from(blocked))])
    }

    fn no_tombstones() -> Vec<MockRow> {
        Vec::new()
    }

    #[tokio::test]
    async fn count_followers_dedupes_follower_identities() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                (event_row(1, "alice", 1), follow_row(1, "target")),
                (event_row(2, "alice", 2), follow_row(2, "target")),
                (event_row(3, "bob", 1), follow_row(3, "target")),
            ]])
            .append_query_results([no_tombstones()])
            .into_connection();
        let ctx = ctx(db).await;

        let count = Query::count_followers(&ctx, "target").await.unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn count_following_dedupes_followed_identities() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                (event_row(1, "alice", 1), follow_row(1, "bob")),
                (event_row(2, "alice", 2), follow_row(2, "bob")),
                (event_row(3, "alice", 3), follow_row(3, "carol")),
            ]])
            .append_query_results([no_tombstones()])
            .into_connection();
        let ctx = ctx(db).await;

        let count = Query::count_following(&ctx, "alice").await.unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn blocked_set_reads_the_block_cache_table() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                blocked_column_row("bob"),
                blocked_column_row("carol"),
            ]])
            .into_connection();
        let ctx = ctx(db).await;

        let blocked = Query::blocked_set(&ctx, "alice").await.unwrap();
        assert_eq!(
            *blocked,
            HashSet::from(["bob".to_string(), "carol".to_string()])
        );
    }

    #[tokio::test]
    async fn an_anonymous_caller_blocks_nobody() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let ctx = ctx(db).await;

        let ctx = RequestContext::new(&ctx, None);
        let blocked = Query::blocked_set_for_caller(&ctx).await.unwrap();
        assert!(blocked.is_empty());
    }

    #[tokio::test]
    async fn list_followed_identities_ignores_block_events() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                (event_row(1, "alice", 1), follow_row(1, "bob")),
                (event_row(2, "alice", 2), block_content_row(2, "carol")),
            ]])
            .append_query_results([no_tombstones()])
            .into_connection();
        let ctx = ctx(db).await;

        assert_eq!(
            Query::list_followed_identities(&ctx, "alice")
                .await
                .unwrap(),
            ["bob"]
        );
    }

    #[tokio::test]
    async fn blocks_identity_true_for_a_cached_block() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![block_row(1, "alice", "bob")]])
            .into_connection();
        let ctx = ctx(db).await;

        assert!(Query::blocks_identity(&ctx, "alice", "bob").await.unwrap());
    }

    #[tokio::test]
    async fn blocks_identity_false_without_rows() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([Vec::<BlockModel::Model>::new()])
            .into_connection();
        let ctx = ctx(db).await;

        assert!(!Query::blocks_identity(&ctx, "alice", "bob").await.unwrap());
    }

    #[tokio::test]
    async fn list_followers_events_returns_rows_newest_first() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                (event_row(2, "bob", 1), follow_row(2, "target")),
                (event_row(1, "alice", 1), follow_row(1, "target")),
            ]])
            .into_connection();

        let rows = Query::list_followers_events(&db, "target", 10, None)
            .await
            .unwrap();
        let identities: Vec<&str> =
            rows.iter().map(|(e, _)| e.identity.as_str()).collect();
        assert_eq!(identities, ["bob", "alice"]);
    }

    #[tokio::test]
    async fn forward_end_cursor_short_circuits_without_querying() {
        // No mocked results: a database hit would error the query.
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();

        let rows = Query::list_following_events(
            &db,
            "alice",
            10,
            Some(&CursorFilter::Forward(Cursor::End)),
        )
        .await
        .unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn backward_start_cursor_short_circuits_without_querying() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();

        let rows = Query::list_followers_events(
            &db,
            "alice",
            10,
            Some(&CursorFilter::Backward(Cursor::Start)),
        )
        .await
        .unwrap();
        assert!(rows.is_empty());
    }
}
