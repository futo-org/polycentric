use crate::data::{Cursor, CursorFilter, Marker};
use crate::service::feeds::repository::content_join;
use crate::service::proto::{SortPostsBy, SortUsersBy};
use crate::service::search::rpc::search_posts::SortedPostsBy;
use crate::service::search::rpc::search_users::SortedUsersBy;
use crate::util::db::{CONTENT_PREFIX, EVENT_PREFIX, select_model_columns};
use entity::{content, event};
use sea_orm::sea_query::{Expr, Order, Value};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, Iterable,
    JoinType, QueryFilter, QueryOrder, QueryResult, QuerySelect, RelationTrait,
    TryGetError, TryGetableMany,
};
use std::collections::HashSet;
use tonic::Status;

// This type only exists to work around trying to get additional columns (e.g.
// the search rank) from SeaORM.
#[derive(Debug)]
pub struct SearchUsersEvent {
    pub event: event::Model,
    pub content: content::Model,
    pub search_rank: f32,
    pub profile_name: String,
}

impl TryGetableMany for SearchUsersEvent {
    fn try_get_many(
        res: &QueryResult,
        _: &str,
        _: &[String],
    ) -> Result<Self, TryGetError> {
        Self::try_get_many_by_index(res)
    }

    fn try_get_many_by_index(res: &QueryResult) -> Result<Self, TryGetError> {
        Ok(SearchUsersEvent {
            event: FromQueryResult::from_query_result(res, EVENT_PREFIX)?,
            content: FromQueryResult::from_query_result(res, CONTENT_PREFIX)?,
            search_rank: res.try_get_by(SEARCH_RANK_COLUMN)?,
            profile_name: res.try_get_by("profile_name")?,
        })
    }
}

// This type only exists to work around trying to get additional columns (e.g.
// the search rank) from SeaORM.
#[derive(Debug)]
pub struct SearchPostsEvent {
    pub event: event::Model,
    pub content: content::Model,
    pub search_rank: f32,
}

impl TryGetableMany for SearchPostsEvent {
    fn try_get_many(
        res: &QueryResult,
        _: &str,
        _: &[String],
    ) -> Result<Self, TryGetError> {
        Self::try_get_many_by_index(res)
    }

    fn try_get_many_by_index(res: &QueryResult) -> Result<Self, TryGetError> {
        Ok(SearchPostsEvent {
            event: FromQueryResult::from_query_result(res, EVENT_PREFIX)?,
            content: FromQueryResult::from_query_result(res, CONTENT_PREFIX)?,
            search_rank: res.try_get_by(SEARCH_RANK_COLUMN)?,
        })
    }
}

const SEARCH_RANK_COLUMN: &str = "search_rank";

pub struct Query;

impl Query {
    pub(super) async fn search_users<C: ConnectionTrait>(
        db: &C,
        search_query: &str,
        sort_by: SortUsersBy,
        limit: u64,
        cursor_filter: Option<&CursorFilter<SortedUsersBy>>,
    ) -> Result<Vec<SearchUsersEvent>, Status> {
        let cursor_filter =
            cursor_filter.unwrap_or(&CursorFilter::Forward(Cursor::Start));

        let mut query = event::Entity::find().select_only();
        query =
            select_model_columns(query, EVENT_PREFIX, event::Column::iter());
        query = select_model_columns(
            query,
            CONTENT_PREFIX,
            content::Column::iter(),
        );
        query = query
            // TODO: we can use ts_rank_cd as well here.
            .expr_as(
                Expr::cust("ts_rank(search_data, search_query($1))"),
                SEARCH_RANK_COLUMN,
            )
            .expr_as(Expr::cust("content_profile_update.name"), "profile_name")
            .join(JoinType::InnerJoin, content_join())
            .join(
                JoinType::InnerJoin,
                content::Relation::ContentProfileUpdate.def(),
            )
            .filter(Expr::cust_with_values(
                "search_data @@ search_query($1)",
                [search_query],
            ));

        let (column, order) = sort_users_by_column(sort_by);
        QueryOrder::query(&mut query)
            .order_by_expr(Expr::cust(column), order.clone())
            .order_by_expr(Expr::cust("events.id"), order);

        match cursor_filter {
            CursorFilter::Forward(cur) => match cur {
                Cursor::Start => { /* No filtering. */ }
                Cursor::Mid(marker) => {
                    if !marker.sorted_by.matches(sort_by) {
                        return Err(Status::internal(
                            "wrong combination of sort_by and pagination parameters",
                        ));
                    }
                    query = match marker {
                        Marker {
                            sorted_by: SortedUsersBy::Rank(rank),
                            event_id,
                        } => query.filter(Expr::cust_with_values(
                            "(ts_rank(search_data, search_query($$1)), events.id) < ($1, $2)",
                            [Value::from(rank), Value::from(event_id)],
                        )),
                        Marker {
                            sorted_by: SortedUsersBy::Name(name),
                            event_id,
                        } => query.filter(Expr::cust_with_values(
                            "(name, events.id) > ($1, $2)",
                            [Value::from(name), Value::from(event_id)],
                        )),
                    };
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

                    query = match marker {
                        Marker {
                            sorted_by: SortedUsersBy::Rank(rank),
                            event_id,
                        } => query.filter(Expr::cust_with_values(
                            "(ts_rank(search_data, search_query($$1)), events.id) > ($1, $2)",
                            [Value::from(rank), Value::from(event_id)],
                        )),
                        Marker {
                            sorted_by: SortedUsersBy::Name(name),
                            event_id,
                        } => query.filter(Expr::cust_with_values(
                            "(name, events.id) < ($1, $2)",
                            [Value::from(name), Value::from(event_id)],
                        )),
                    };
                }
                Cursor::End => { /* No filtering. */ }
            },
        }
        query = query.limit(limit + 1); // + 1 for pagination.

        let mut rows: Vec<SearchUsersEvent> =
            query.into_tuple().all(db).await.map_err(|err| {
                tracing::warn!("failed to search for users: {err}");
                Status::internal("internal server error")
            })?;

        // Keep the highest sequence row per identity.
        let mut seen = HashSet::new();
        rows.extract_if(.., |row| {
            if seen.contains(&row.event.identity) {
                true // Remove
            } else {
                seen.insert(row.event.identity.clone());
                false
            }
        })
        .for_each(drop);
        Ok(rows)
    }

    pub(super) async fn search_posts<C: ConnectionTrait>(
        db: &C,
        search_query: &str,
        sort_by: SortPostsBy,
        limit: u64,
        cursor_filter: Option<&CursorFilter<SortedPostsBy>>,
    ) -> Result<Vec<SearchPostsEvent>, Status> {
        let cursor_filter =
            cursor_filter.unwrap_or(&CursorFilter::Forward(Cursor::Start));

        let mut query = event::Entity::find().select_only();
        query =
            select_model_columns(query, EVENT_PREFIX, event::Column::iter());
        query = select_model_columns(
            query,
            CONTENT_PREFIX,
            content::Column::iter(),
        );
        query = query
            // TODO: we can use ts_rank_cd as well here.
            .expr_as(
                Expr::cust("ts_rank(search_data, search_query($1))"),
                SEARCH_RANK_COLUMN,
            )
            .join(JoinType::InnerJoin, content_join())
            .join(JoinType::InnerJoin, content::Relation::ContentPost.def())
            .filter(Expr::cust_with_values(
                "search_data @@ search_query($1)",
                [search_query],
            ));

        let column = sort_posts_by_column(sort_by);
        QueryOrder::query(&mut query)
            .order_by_expr(column, Order::Desc)
            .order_by(event::Column::Id.as_column_ref(), Order::Desc);

        match cursor_filter {
            CursorFilter::Forward(cur) => match cur {
                Cursor::Start => { /* No filtering. */ }
                Cursor::Mid(marker) => {
                    if !marker.sorted_by.matches(sort_by) {
                        return Err(Status::internal(
                            "wrong combination of sort_by and pagination parameters",
                        ));
                    }
                    query = match marker {
                        Marker {
                            sorted_by: SortedPostsBy::Rank(rank),
                            event_id,
                        } => query.filter(Expr::cust_with_values(
                            "(ts_rank(search_data, search_query($$1)), events.id) < ($1, $2)",
                            [Value::from(rank), Value::from(event_id)],
                        )),
                        Marker {
                            sorted_by: SortedPostsBy::Latest(created_at),
                            event_id,
                        } => query.filter(Expr::cust_with_values(
                            "(events.created_at, events.id) < ($1, $2)",
                            [Value::from(*created_at), Value::from(event_id)],
                        )),
                    };
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

                    query = match marker {
                        Marker {
                            sorted_by: SortedPostsBy::Rank(rank),
                            event_id,
                        } => query.filter(Expr::cust_with_values(
                            "(ts_rank(search_data, search_query($$1)), events.id) > ($1, $2)",
                            [Value::from(rank), Value::from(event_id)],
                        )),
                        Marker {
                            sorted_by: SortedPostsBy::Latest(created_at),
                            event_id,
                        } => query.filter(Expr::cust_with_values(
                            "(events.created_at, events.id) > ($1, $2)",
                            [Value::from(*created_at), Value::from(event_id)],
                        )),
                    };
                }
                Cursor::End => { /* No filtering. */ }
            },
        }
        query = query.limit(limit + 1); // + 1 for pagination.

        query.into_tuple().all(db).await.map_err(|err| {
            tracing::warn!("failed to search for users: {err}");
            Status::internal("internal server error")
        })
    }
}

fn sort_users_by_column(sort_by: SortUsersBy) -> (&'static str, Order) {
    match sort_by {
        SortUsersBy::Default => (SEARCH_RANK_COLUMN, Order::Desc),
        SortUsersBy::Alpha => ("name", Order::Asc),
    }
}

fn sort_posts_by_column(sort_by: SortPostsBy) -> Expr {
    match sort_by {
        SortPostsBy::Default => Expr::col(SEARCH_RANK_COLUMN),
        SortPostsBy::Top => unimplemented!(),
        SortPostsBy::Latest => {
            Expr::col(event::Column::CreatedAt.as_column_ref())
        }
    }
}
