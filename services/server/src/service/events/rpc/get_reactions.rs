use crate::data::hydration::HydrationState;
use crate::data::{EventWithContentRow, assemble_bundles, pipeline};
use crate::service::context::ServiceContext;
use crate::service::events::TargetEventKey;
use crate::service::events::tombstone::{self, HasEventKey};
use crate::service::feeds::repository::Query as FeedsRepository;
use crate::service::feeds::util::{map_db_err, page_limit};
use crate::service::identity::service::list_identity_and_profile_events;
use crate::service::proofs::service::attach_proofs;
use crate::service::proto::{GetReactionsRequest, GetReactionsResponse};

use std::collections::HashSet;
use tonic::Status;

struct Params {
    target: TargetEventKey,
    emoji: Option<String>,
    limit: u64,
}

pub async fn handle(
    ctx: &ServiceContext,
    req: GetReactionsRequest,
) -> Result<GetReactionsResponse, Status> {
    // TODO: support pagination
    let params = Params {
        target: TargetEventKey::from_request(req.target, "target")?,
        emoji: req.emoji_filter,
        limit: page_limit(&req.page_params),
    };

    pipeline::create_pipeline(ctx, &params, fetch, hydrate, filter, view).await
}

async fn fetch(
    ctx: &ServiceContext,
    params: &Params,
) -> Result<Vec<EventWithContentRow>, Status> {
    FeedsRepository::get_reactions(
        &ctx.ro_db,
        &params.target,
        params.emoji.as_deref(),
        params.limit,
    )
    .await
    .map_err(map_db_err)
}

#[allow(clippy::ptr_arg)] // signature must match pipeline's HRTB (&Fetched = &Vec<…>)
async fn hydrate(
    ctx: &ServiceContext,
    _params: &Params,
    rows: &Vec<EventWithContentRow>,
) -> Result<HydrationState, Status> {
    let keys: Vec<TargetEventKey> =
        rows.iter().map(HasEventKey::event_key).collect();

    let deletes_by_target = tombstone::validated_tombstones(ctx, &keys).await?;

    let identities = rows
        .iter()
        .map(|(event, _)| event.identity.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    let (identity_events, profile_events) =
        list_identity_and_profile_events(ctx, identities).await?;

    Ok(HydrationState {
        deletes_by_target,
        identity_events,
        profile_events,
        ..Default::default()
    })
}

/// Remove any deleted or superseded reaction events.
async fn filter(
    _ctx: &ServiceContext,
    _params: &Params,
    rows: Vec<EventWithContentRow>,
    hydration: &HydrationState,
) -> Result<Vec<EventWithContentRow>, Status> {
    let mut seen: HashSet<String> = HashSet::new();

    let live_rows = rows
        .into_iter()
        .filter(|row| {
            !hydration.deletes_by_target.contains_key(&row.event_key())
        })
        .filter(|(event, _)| seen.insert(event.identity.clone()))
        .collect();

    Ok(live_rows)
}

async fn view(
    ctx: &ServiceContext,
    _params: &Params,
    rows: Vec<EventWithContentRow>,
    hydration: HydrationState,
) -> Result<GetReactionsResponse, Status> {
    let mut event_bundles = assemble_bundles(rows, &hydration.stats);
    attach_proofs(ctx, &mut event_bundles).await?;

    Ok(GetReactionsResponse {
        event_bundles,
        event_hints: hydration.identity_profile_hints(),
        // TODO: support pagination
        page_info: None,
    })
}
