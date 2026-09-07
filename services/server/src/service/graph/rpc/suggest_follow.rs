//! `suggest_follow`: profile (update events) the identity could follow.

use tonic::Status;

use crate::data::hydration::{self, HydrateConfig, HydrationState};
use crate::data::{
    EventRow, Marker, PageInfo, PaginationParams, assemble_bundle, pipeline,
};
use crate::service::context::RequestContext;
use crate::service::graph::repository::{
    FollowSuggestionEvent, FollowSuggestionsSortedBy, Query,
};
use crate::service::proto::{
    FollowSuggestion, SuggestFollowRequest, SuggestFollowResponse,
};

struct Params {
    pagination: PaginationParams<FollowSuggestionsSortedBy>,
    identity: String,
}

pub async fn handle(
    ctx: &RequestContext<'_>,
    req: SuggestFollowRequest,
) -> Result<SuggestFollowResponse, Status> {
    let identity = match ctx.caller {
        Some(identity) if !identity.is_empty() => identity.to_owned(),
        _ => return Err(Status::invalid_argument("identity is required")),
    };
    let pagination =
        PaginationParams::from_req_params(req.page_params.as_ref())?;
    let params = Params {
        pagination,
        identity,
    };

    pipeline::create_pipeline(ctx, &params, fetch, hydrate, filter, view).await
}

struct Fetched {
    rows: Vec<FollowSuggestionEvent>,
    page_info: PageInfo<FollowSuggestionsSortedBy>,
}

async fn fetch(
    ctx: &RequestContext<'_>,
    params: &Params,
) -> Result<Fetched, Status> {
    let mut rows = Query::suggest_follow(
        &ctx.service.ro_db,
        &params.identity,
        params.pagination.cursor_filter.as_ref(),
        params.pagination.limit,
    )
    .await
    .map_err(|err| {
        tracing::error!(error = %err, "failed to suggest identities to follow");
        Status::internal("internal server error")
    })?;

    let page_info = pipeline::finalize_fetch(
        &mut rows,
        params.pagination.cursor_filter.as_ref(),
        params.pagination.limit,
        |row| Marker {
            sorted_by: row.followers.len().cast_signed() as i32,
            event_id: row.event.id,
        },
    );
    Ok(Fetched { rows, page_info })
}

async fn hydrate(
    ctx: &RequestContext<'_>,
    _: &Params,
    fetched: &Fetched,
) -> Result<HydrationState, Status> {
    let mut hydration =
        hydration::hydrate(ctx, &fetched.rows, &HydrateConfig::default())
            .await?;

    let follows = fetched
        .rows
        .iter()
        .flat_map(|row| {
            row.followers
                .iter()
                .map(|follower| (&*row.event.identity, &**follower))
        })
        .collect::<Vec<_>>();
    let follow_events = Query::follow_events(&ctx.service.ro_db, follows)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "failed to get follow events");
            Status::internal("internal server error")
        })?;
    hydration.follow_events.extend(follow_events);

    Ok(hydration)
}

struct Filtered {
    live_rows: Vec<FollowSuggestionEvent>,
    page_info: PageInfo<FollowSuggestionsSortedBy>,
}

async fn filter(
    _: &RequestContext<'_>,
    _: &Params,
    fetched: Fetched,
    hydration: &HydrationState,
) -> Result<Filtered, Status> {
    let Fetched { rows, page_info } = fetched;
    let live_rows = rows
        .into_iter()
        .filter(|row| {
            !hydration.blocked_identities.contains(&row.event.identity)
                && !hydration.deletes_by_target.contains_key(&row.event_key())
        })
        .collect();

    Ok(Filtered {
        live_rows,
        page_info,
    })
}

async fn view(
    _: &RequestContext<'_>,
    _: &Params,
    filtered: Filtered,
    hydration: HydrationState,
) -> Result<SuggestFollowResponse, Status> {
    let suggestions = filtered
        .live_rows
        .into_iter()
        .map(|row| FollowSuggestion {
            suggestion: Some(assemble_bundle(
                (row.event, Some(row.content)),
                &hydration.stats,
            )),
            followers: row.followers,
        })
        .collect();

    Ok(SuggestFollowResponse {
        suggestions,
        page_info: Some(filtered.page_info.to_proto()?),
        event_hints: hydration.into_hints(),
    })
}
