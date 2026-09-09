use tonic::Status;

use crate::data::hydration::HydrationState;
use crate::data::pipeline::Fetched;
use crate::data::{EventRow, PageInfo};
use crate::service::context::ServiceContext;

/// Filter out deleted events.
pub async fn deleted<Ctx, Params, Row, SortedBy>(
    _: &Ctx,
    _: &Params,
    fetched: Fetched<Row, SortedBy>,
    hydration: &HydrationState,
) -> Result<Filtered<Row, SortedBy>, Status>
where
    Row: EventRow,
{
    let Fetched { rows, page_info } = fetched;
    let rows = rows
        .into_iter()
        .filter(|row| {
            !hydration.deletes_by_target.contains_key(&row.event_key())
        })
        .collect();
    Ok(Filtered { rows, page_info })
}

/// Filter out deleted events or events by blocked identities..
pub async fn deleted_or_blocked<Ctx, Params, Row, SortedBy>(
    _: &Ctx,
    _: &Params,
    fetched: Fetched<Row, SortedBy>,
    hydration: &HydrationState,
) -> Result<Filtered<Row, SortedBy>, Status>
where
    Row: EventRow,
{
    let Fetched { rows, page_info } = fetched;
    let rows = rows
        .into_iter()
        .filter(|row| {
            !hydration
                .blocked_identities
                .contains(&row.as_event().identity)
                && !hydration.deletes_by_target.contains_key(&row.event_key())
        })
        .collect();
    Ok(Filtered { rows, page_info })
}

pub struct Filtered<Row, SortedBy> {
    pub rows: Vec<Row>,
    pub page_info: PageInfo<SortedBy>,
}
