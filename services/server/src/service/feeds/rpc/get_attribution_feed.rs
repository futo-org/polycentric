//! `get_attribution_feed`: posts attributed to a given target (e.g. all
//! posts about a URL), newest first. For a link, "attributed to" means an
//! exact URL match, ignoring the other Link metadata.

use crate::{
    data::{
        hydration::{HydrationState, post_hydrate},
        pipeline,
    },
    service::{
        context::RequestContext,
        feeds::{
            repository::Query as FeedsRepository,
            rpc::common::{
                self as feeds_pipeline, GetFeedResponseFilter,
                GetFeedResponseView,
            },
            util::map_db_err,
        },
        proto::{
            GetAttributionFeedRequest, GetFeedResponse, attributed_to::To,
        },
    },
};
use tonic::Status;

pub struct Params {
    pub common: feeds_pipeline::Params,
    pub url: String,
}

pub async fn handle(
    ctx: &RequestContext<'_>,
    req: GetAttributionFeedRequest,
) -> Result<GetFeedResponse, Status> {
    // Only link attribution is queryable today; extract its URL.
    let url = match req.attributed_to.and_then(|a| a.to) {
        Some(To::Link(link)) => link.url,
        None => {
            return Err(Status::invalid_argument("attributed_to is required"));
        }
    };
    if url.is_empty() {
        return Err(Status::invalid_argument(
            "attributed_to link url is required",
        ));
    }

    let common = feeds_pipeline::Params::from_req_params(
        &req.page_params,
        req.omit_labels,
    )?;
    let params = Params { common, url };

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
) -> Result<feeds_pipeline::Fetched, Status> {
    let rows = FeedsRepository::list_feed_events_by_attributed_url(
        &ctx.service.ro_db,
        params.url.clone(),
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
    params: &Params,
    fetched: feeds_pipeline::Fetched,
    hydration: &HydrationState,
) -> Result<GetFeedResponseFilter, Status> {
    feeds_pipeline::filter(fetched, hydration, &params.common.omit_labels).await
}

async fn view(
    ctx: &RequestContext<'_>,
    _params: &Params,
    filtered: GetFeedResponseFilter,
    hydration: HydrationState,
) -> Result<GetFeedResponseView, Status> {
    feeds_pipeline::view(ctx.service, filtered, hydration).await
}
