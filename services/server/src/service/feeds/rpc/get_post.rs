use std::slice;

use crate::data::hydration::{HydrationState, post_hydrate};
use crate::data::{
    EventRow, EventWithContentRow, assemble_bundle, assemble_bundles,
    assemble_hint, bundle_into_hint, pipeline,
};
use crate::service::context::RequestContext;
use crate::service::feeds::repository::Query;
use crate::service::proofs::service::attach_proofs;
use crate::service::proto::{
    EventBundle, EventKey, GetPostRequest, GetPostResponse,
};

use tonic::Status;

pub async fn handle(
    ctx: &RequestContext<'_>,
    req: GetPostRequest,
) -> Result<GetPostResponse, Status> {
    let Some(event_key) = req.event_key else {
        return Err(Status::invalid_argument(format!("event_key is required")));
    };
    let params = Params { event_key };
    pipeline::create_pipeline(ctx, &params, fetch, hydrate, filter, view).await
}

struct Params {
    event_key: EventKey,
}

async fn fetch(
    ctx: &RequestContext<'_>,
    params: &Params,
) -> Result<Option<EventWithContentRow>, Status> {
    Query::get_post(&ctx.service.ro_db, &params.event_key).await
}

async fn hydrate(
    ctx: &RequestContext<'_>,
    _: &Params,
    row: &Option<EventWithContentRow>,
) -> Result<HydrationState, Status> {
    if let Some(row) = row.as_ref() {
        post_hydrate(ctx, slice::from_ref(row)).await
    } else {
        Ok(HydrationState::default())
    }
}

async fn filter(
    _: &RequestContext<'_>,
    _: &Params,
    row: Option<EventWithContentRow>,
    hydration: &HydrationState,
) -> Result<Option<EventWithContentRow>, Status> {
    if let Some(r) = row.as_ref() {
        if hydration
            .blocked_identities
            .contains(&r.as_event().identity)
            || hydration.deletes_by_target.contains_key(&r.event_key())
        {
            return Ok(None);
        }
    }

    Ok(row)
}

async fn view(
    ctx: &RequestContext<'_>,
    _params: &Params,
    row: Option<EventWithContentRow>,
    hydration: HydrationState,
) -> Result<GetPostResponse, Status> {
    let HydrationState {
        deletes_by_target,
        identity_events,
        profile_events,
        quote_post_events,
        repost_events,
        label_events,
        stats,
        ..
    } = hydration;

    let mut event_bundle = row.map(|row| assemble_bundle(row, &stats));
    let mut tombstone_bundles: Vec<EventBundle> =
        deletes_by_target.into_values().flatten().collect();
    let mut label_bundles = assemble_bundles(label_events, &stats);

    tokio::try_join!(
        async {
            if let Some(event_bundle) = event_bundle.as_mut() {
                attach_proofs(&ctx.service, slice::from_mut(event_bundle)).await
            } else {
                Ok(())
            }
        },
        attach_proofs(&ctx.service, &mut tombstone_bundles),
        attach_proofs(&ctx.service, &mut label_bundles),
    )?;

    let event_hints = identity_events
        .into_iter()
        .chain(profile_events)
        .chain(quote_post_events)
        .chain(repost_events)
        .map(|row| assemble_hint(row, &stats))
        .chain(tombstone_bundles.into_iter().map(bundle_into_hint))
        .chain(label_bundles.into_iter().map(bundle_into_hint))
        .collect::<Vec<_>>();

    Ok(GetPostResponse {
        event_bundle,
        event_hints,
    })
}
