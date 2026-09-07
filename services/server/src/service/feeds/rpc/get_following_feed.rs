//! `get_following_feed`: posts from identities the caller follows
//! (plus the caller's own posts).

use crate::data::hydration::{HydrationState, post_hydrate};
use crate::data::{Marker, pipeline};
use crate::service::context::RequestContext;
use crate::service::feeds::repository::{Query as FeedsRepository, SortedBy};
use crate::service::feeds::rpc::common::{
    self as feeds_pipeline, Fetched, GetFeedResponseFilter, GetFeedResponseView,
};
use crate::service::proto::{
    GetFeedResponse, GetFollowingFeedRequest, SortPostsBy,
};
use tonic::Status;

pub struct Params {
    pub common: feeds_pipeline::Params<SortedBy>,
    pub sort_by: SortPostsBy,
    pub identity: String,
}

pub async fn handle(
    ctx: &RequestContext<'_>,
    req: GetFollowingFeedRequest,
) -> Result<GetFeedResponse, Status> {
    if req.follower_identity.is_empty() {
        return Err(Status::invalid_argument("follower_identity is required"));
    }

    let sort_by = req.sort_by();
    let common = feeds_pipeline::Params::from_req_params(
        &req.page_params,
        req.omit_labels,
    )?;
    let params = Params {
        common,
        sort_by,
        identity: req.follower_identity,
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

async fn fetch(
    ctx: &RequestContext<'_>,
    params: &Params,
) -> Result<feeds_pipeline::Fetched<SortedBy>, Status> {
    let mut rows = FeedsRepository::following_feed(
        &ctx.service.ro_db,
        &params.identity,
        params.sort_by,
        params.common.limit + 1,
        params.common.cursor_filter.as_ref(),
    )
    .await?;

    let page_info = pipeline::finalize_fetch(
        &mut rows,
        params.common.cursor_filter.as_ref(),
        params.common.limit as u32,
        |row| {
            let sorted_by = match params.sort_by {
                SortPostsBy::Default | SortPostsBy::Latest => {
                    SortedBy::CreatedAt(row.event.created_at)
                }
                SortPostsBy::Top => {
                    SortedBy::ReactionCount(row.reactions.clone())
                }
            };
            Marker {
                sorted_by,
                event_id: row.event.id,
            }
        },
    );
    let rows = rows
        .into_iter()
        .map(|row| (row.event, Some(row.content)))
        .collect();
    Ok(Fetched { rows, page_info })
}

async fn hydrate(
    ctx: &RequestContext<'_>,
    _: &Params,
    fetched: &feeds_pipeline::Fetched<SortedBy>,
) -> Result<HydrationState, Status> {
    post_hydrate(ctx, &fetched.rows).await
}

async fn filter(
    _: &RequestContext<'_>,
    params: &Params,
    fetched: feeds_pipeline::Fetched<SortedBy>,
    hydration: &HydrationState,
) -> Result<GetFeedResponseFilter<SortedBy>, Status> {
    feeds_pipeline::filter(fetched, hydration, &params.common.omit_labels).await
}

async fn view(
    ctx: &RequestContext<'_>,
    _: &Params,
    filtered: GetFeedResponseFilter<SortedBy>,
    hydration: HydrationState,
) -> Result<GetFeedResponseView<SortedBy>, Status> {
    feeds_pipeline::view(ctx.service, filtered, hydration).await
}
