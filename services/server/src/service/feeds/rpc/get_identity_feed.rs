//! `get_identity_feed`: posts authored by a specific identity,
//! newest first.

use crate::data::hydration::{HydrationState, post_hydrate};
use crate::data::{Cursor, PageInfo, pipeline};
use crate::service::{
    context::RequestContext,
    feeds::{
        repository::{EventCreatedAt, Query as FeedsRepository},
        rpc::common::{
            self as feeds_pipeline, GetFeedResponseFilter, GetFeedResponseView,
        },
        util::map_db_err,
    },
    graph::repository::Query as GraphRepository,
    proto::{GetFeedResponse, GetIdentityFeedRequest},
};
use tonic::Status;

pub struct Params {
    pub common: feeds_pipeline::Params,
    pub identity: String,
}

pub async fn handle(
    ctx: &RequestContext<'_>,
    req: GetIdentityFeedRequest,
) -> Result<GetFeedResponse, Status> {
    if req.identity.is_empty() {
        return Err(Status::invalid_argument("identity is required"));
    }

    if caller_blocks_subject(ctx, &req.identity).await? {
        return blocked_identity_response();
    }

    let common = feeds_pipeline::Params::from_req_params(
        &req.page_params,
        req.omit_labels,
    )?;
    let params = Params {
        common,
        identity: req.identity,
    };

    let result =
        pipeline::create_pipeline(ctx, &params, fetch, hydrate, filter, view)
            .await?;
    Ok(GetFeedResponse {
        event_bundles: result.event_bundles,
        event_hints: result.event_hints,
        page_info: Some(result.page_info.to_proto()?),
    })
}

/// Whether the caller blocks the identity whose feed was requested. A caller
/// never blocks their own feed.
async fn caller_blocks_subject(
    ctx: &RequestContext<'_>,
    subject: &str,
) -> Result<bool, Status> {
    let Some(caller) = ctx.caller.filter(|caller| *caller != subject) else {
        return Ok(false);
    };
    GraphRepository::blocks_identity(ctx.service, caller, subject).await
}

/// Produce a terminal empty page (`has_next_page: false`) for profile feeds
/// that the authenticated user has blocked.
fn blocked_identity_response() -> Result<GetFeedResponse, Status> {
    let page_info: PageInfo<EventCreatedAt> = PageInfo {
        backward_cursor: Cursor::End,
        forward_cursor: Cursor::End,
        has_previous_page: false,
        has_next_page: false,
    };
    Ok(GetFeedResponse {
        event_bundles: vec![],
        event_hints: vec![],
        page_info: Some(page_info.to_proto()?),
    })
}

async fn fetch(
    ctx: &RequestContext<'_>,
    params: &Params,
) -> Result<feeds_pipeline::Fetched, Status> {
    let rows = FeedsRepository::list_feed_events_by_identities(
        &ctx.service.ro_db,
        vec![params.identity.clone()],
        params.common.limit + 1, // Check for next page
        &params.common.cursor_filter,
    )
    .await
    .map_err(map_db_err)?;
    Ok(feeds_pipeline::finalize_fetch(rows, &params.common))
}

async fn hydrate(
    ctx: &RequestContext<'_>,
    _params: &Params,
    fetched: &feeds_pipeline::Fetched,
) -> Result<HydrationState, Status> {
    post_hydrate(ctx, &fetched.rows).await
}

async fn filter(
    _ctx: &RequestContext<'_>,
    _params: &Params,
    fetched: feeds_pipeline::Fetched,
    hydration: &HydrationState,
) -> Result<GetFeedResponseFilter, Status> {
    feeds_pipeline::filter(fetched, hydration, &_params.common.omit_labels)
        .await
}

async fn view(
    ctx: &RequestContext<'_>,
    _params: &Params,
    filtered: GetFeedResponseFilter,
    hydration: HydrationState,
) -> Result<GetFeedResponseView, Status> {
    feeds_pipeline::view(ctx.service, filtered, hydration).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::context::ServiceContext;
    use ::entity::block_model as BlockModel;
    use sea_orm::{DbBackend, MockDatabase};
    use std::sync::Arc;

    async fn ctx_where_alice_blocks_bob() -> Arc<ServiceContext> {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![BlockModel::Model {
                event_id: 1,
                blocker: "alice".to_string(),
                blocked: "bob".to_string(),
            }]])
            .into_connection();
        let kafka_producer = common_kafka::build_producer()
            .await
            .expect("failed to build Kafka producer");
        ServiceContext::new(db, kafka_producer)
    }

    #[tokio::test]
    async fn a_blocked_identity_feed_is_empty_and_terminal() {
        let ctx = ctx_where_alice_blocks_bob().await;

        let ctx = RequestContext::new(&ctx, Some("alice"));

        let response = handle(
            &ctx,
            GetIdentityFeedRequest {
                identity: "bob".to_string(),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert!(response.event_bundles.is_empty());
        assert!(response.event_hints.is_empty());

        let page_info = response.page_info.unwrap();
        assert!(!page_info.has_next_page);
        assert!(!page_info.has_previous_page);
        assert!(matches!(
            Cursor::<EventCreatedAt>::decode(&page_info.start_cursor).unwrap(),
            Cursor::End
        ));
        assert!(matches!(
            Cursor::<EventCreatedAt>::decode(&page_info.end_cursor).unwrap(),
            Cursor::End
        ));
    }

    #[tokio::test]
    async fn an_empty_identity_is_rejected() {
        let ctx = ctx_where_alice_blocks_bob().await;

        let ctx = RequestContext::new(&ctx, Some("alice"));

        let result = handle(&ctx, GetIdentityFeedRequest::default()).await;

        assert_eq!(result.unwrap_err().code(), tonic::Code::InvalidArgument);
    }
}
