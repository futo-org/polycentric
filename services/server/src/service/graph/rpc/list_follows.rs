//! Shared handler for `ListFollowing` / `ListFollowers`: a page of
//! Follow events, tombstone-filtered, newest first.

use crate::data::hydration::{HydrationState, collect_identities};
use crate::data::{
    CursorFilter, EventWithContentRow, PaginationParams, assemble_bundles,
    pipeline,
};
use crate::service::context::ServiceContext;
use crate::service::events::{TargetEventKey, tombstone};
use crate::service::feeds::repository::EventCreatedAt;
use crate::service::feeds::rpc::common as feeds_pipeline;
use crate::service::feeds::util::map_db_err;
use crate::service::graph::repository::Query as GraphRepository;
use crate::service::identity::service::list_identity_and_profile_events;
use crate::service::proto::{ListFollowsResponse, PageParams};
use sea_orm::DbConn;
use tonic::Status;

/// Which side of the follow edge to list.
pub enum Direction {
    Following,
    Followers,
}

struct Params {
    pagination: PaginationParams<EventCreatedAt>,
    identity: String,
    direction: Direction,
}

struct Filtered {
    live_rows: Vec<EventWithContentRow>,
    page_info: feeds_pipeline::Fetched,
}

pub async fn handle(
    ctx: &ServiceContext,
    identity: String,
    page_params: Option<&PageParams>,
    direction: Direction,
) -> Result<ListFollowsResponse, Status> {
    if identity.is_empty() {
        return Err(Status::invalid_argument("identity is required"));
    }

    let params = Params {
        pagination: PaginationParams::from_req_params(page_params)?,
        identity,
        direction,
    };

    pipeline::create_pipeline(ctx, &params, fetch, hydrate, filter, view).await
}

async fn list_page(
    db: &DbConn,
    params: &Params,
    limit: u32,
    cursor_filter: Option<&CursorFilter<EventCreatedAt>>,
) -> Result<Vec<EventWithContentRow>, sea_orm::DbErr> {
    match params.direction {
        Direction::Following => {
            GraphRepository::list_following_events(
                db,
                &params.identity,
                limit,
                cursor_filter,
            )
            .await
        }
        Direction::Followers => {
            GraphRepository::list_followers_events(
                db,
                &params.identity,
                limit,
                cursor_filter,
            )
            .await
        }
    }
}

async fn fetch(
    ctx: &ServiceContext,
    params: &Params,
) -> Result<feeds_pipeline::Fetched, Status> {
    let mut rows = list_page(
        &ctx.ro_db,
        params,
        params.pagination.limit + 1, // Check for next page
        params.pagination.cursor_filter.as_ref(),
    )
    .await
    .map_err(map_db_err)?;

    let page_info = pipeline::finalize_fetch(
        &mut rows,
        params.pagination.cursor_filter.as_ref(),
        params.pagination.limit,
        feeds_pipeline::create_event_created_at_marker,
    );
    Ok(feeds_pipeline::Fetched { rows, page_info })
}

async fn hydrate(
    ctx: &ServiceContext,
    _params: &Params,
    fetched: &feeds_pipeline::Fetched,
) -> Result<HydrationState, Status> {
    let keys: Vec<TargetEventKey> = fetched
        .rows
        .iter()
        .map(|(e, _)| TargetEventKey::of(e))
        .collect();

    let raw = tombstone::list_tombstones_for_event_keys(&ctx.ro_db, &keys)
        .await
        .map_err(map_db_err)?;
    let deletes_by_target = tombstone::validate_tombstones(ctx, raw).await?;

    let identities = collect_identities(
        ctx.trusted_moderator.as_deref(),
        fetched.rows.iter(),
    );
    let (identity_events, profile_events) =
        list_identity_and_profile_events(ctx, identities).await?;

    Ok(HydrationState {
        deletes_by_target,
        identity_events,
        profile_events,
        ..Default::default()
    })
}

async fn filter(
    _ctx: &ServiceContext,
    _params: &Params,
    fetched: feeds_pipeline::Fetched,
    hydration: &HydrationState,
) -> Result<Filtered, Status> {
    let mut fetched = fetched;
    let rows = std::mem::take(&mut fetched.rows);
    let live_rows = rows
        .into_iter()
        .filter(|row| {
            !hydration
                .deletes_by_target
                .contains_key(&TargetEventKey::of(&row.0))
        })
        .collect();
    Ok(Filtered {
        live_rows,
        page_info: fetched,
    })
}

async fn view(
    _ctx: &ServiceContext,
    _params: &Params,
    filtered: Filtered,
    hydration: HydrationState,
) -> Result<ListFollowsResponse, Status> {
    Ok(ListFollowsResponse {
        event_bundles: assemble_bundles(filtered.live_rows, &hydration.stats),
        page_info: Some(filtered.page_info.page_info.to_proto()?),
        event_hints: hydration.identity_profile_hints(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::proto::{Content, Follow, content::ContentBody};
    use ::entity::content_model as ContentModel;
    use ::entity::event_model as EventModel;
    use chrono::DateTime;
    use polycentric_common::models::collections;
    use prost::Message as _;
    use sea_orm::prelude::DateTimeWithTimeZone;
    use sea_orm::{DatabaseConnection, DbBackend, MockDatabase, MockRow};
    use std::sync::Arc;

    async fn ctx(db: DatabaseConnection) -> Arc<ServiceContext> {
        let kafka_producer = common_kafka::build_producer()
            .await
            .expect("failed to build Kafka producer");
        ServiceContext::new(db, kafka_producer)
    }

    fn ts(seconds: i64) -> DateTimeWithTimeZone {
        DateTime::from_timestamp_secs(seconds)
            .unwrap()
            .fixed_offset()
    }

    fn follow_row(
        id: i64,
        follower: &str,
        target: &str,
    ) -> (EventModel::Model, ContentModel::Model) {
        let content = Content {
            content_body: Some(ContentBody::Follow(Follow {
                identity: target.to_string(),
            })),
        };
        (
            EventModel::Model {
                id,
                collection: collections::SOCIAL_GRAPH as i16,
                identity: follower.to_string(),
                public_key_type: 1,
                public_key: vec![0xaa],
                sequence: id,
                content_digest_type: Some(1),
                content_digest_bytes: Some(vec![id as u8]),
                signature: vec![id as u8],
                previous_signature: vec![],
                previous_root: vec![],
                application_id: None,
                event_bytes: vec![id as u8],
                created_at: ts(id),
                synced_at: ts(id),
            },
            ContentModel::Model {
                id,
                digest_type: 1,
                digest_bytes: vec![id as u8],
                serialized_bytes: content.encode_to_vec(),
                synced_at: ts(id),
            },
        )
    }

    fn no_tombstones() -> Vec<MockRow> {
        Vec::new()
    }

    /// Empty result set for the identity/profile hint queries.
    fn no_rows() -> Vec<MockRow> {
        Vec::new()
    }

    #[tokio::test]
    async fn returns_a_full_page_with_a_next_page() {
        // Three rows for a limit of two: the extra row signals more data.
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                follow_row(3, "carol", "target"),
                follow_row(2, "bob", "target"),
                follow_row(1, "alice", "target"),
            ]])
            .append_query_results([no_tombstones()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .into_connection();
        let ctx = ctx(db).await;

        let response = handle(
            &ctx,
            "target".to_string(),
            Some(&PageParams {
                limit: Some(2),
                backward_token: None,
                forward_token: None,
            }),
            Direction::Followers,
        )
        .await
        .unwrap();

        assert_eq!(response.event_bundles.len(), 2);
        let page_info = response.page_info.unwrap();
        assert!(page_info.has_next_page);
        assert!(!page_info.has_previous_page);
        assert!(!page_info.end_cursor.is_empty());
    }

    #[tokio::test]
    async fn last_page_has_no_next_page() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![follow_row(1, "alice", "target")]])
            .append_query_results([no_tombstones()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .into_connection();
        let ctx = ctx(db).await;

        let response = handle(
            &ctx,
            "target".to_string(),
            Some(&PageParams {
                limit: Some(2),
                backward_token: None,
                forward_token: None,
            }),
            Direction::Following,
        )
        .await
        .unwrap();

        assert_eq!(response.event_bundles.len(), 1);
        assert!(!response.page_info.unwrap().has_next_page);
    }

    #[tokio::test]
    async fn bundles_carry_the_event_and_content_bytes() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![follow_row(1, "alice", "target")]])
            .append_query_results([no_tombstones()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .into_connection();
        let ctx = ctx(db).await;

        let response =
            handle(&ctx, "target".to_string(), None, Direction::Followers)
                .await
                .unwrap();

        let bundle = &response.event_bundles[0];
        assert_eq!(bundle.signed_event.as_ref().unwrap().event_bytes, vec![1]);
        let content = Content::decode(
            bundle
                .serialized_content
                .as_ref()
                .unwrap()
                .content_bytes
                .as_slice(),
        )
        .unwrap();
        match content.content_body.unwrap() {
            ContentBody::Follow(follow) => {
                assert_eq!(follow.identity, "target")
            }
            other => panic!("expected a follow, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn rejects_an_empty_identity() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let ctx = ctx(db).await;

        let result =
            handle(&ctx, String::new(), None, Direction::Followers).await;
        assert_eq!(result.unwrap_err().code(), tonic::Code::InvalidArgument);
    }
}
