use tonic::Status;

use crate::data::hydration::HydrationState;
use crate::data::pipeline::Fetched;
use crate::data::{EventRow, PageInfo};
use crate::service::context::{RequestContext, ServiceContext};

/// Filter out deleted events.
pub async fn deleted<Params, Row, SortedBy>(
    _: &ServiceContext,
    _: &Params,
    fetched: Fetched<Row, SortedBy>,
    hydration: &HydrationState,
) -> Result<Filtered<Row, SortedBy>, Status>
where
    Row: EventRow,
{
    let Fetched {
        mut rows,
        page_info,
    } = fetched;
    rows.retain(|row| {
        !hydration.deletes_by_target.contains_key(&row.event_key())
    });
    Ok(Filtered { rows, page_info })
}

/// Filter out deleted events or events by blocked identities.
pub async fn deleted_or_blocked<Params, Row, SortedBy>(
    _: &RequestContext<'_>,
    _: &Params,
    fetched: Fetched<Row, SortedBy>,
    hydration: &HydrationState,
) -> Result<Filtered<Row, SortedBy>, Status>
where
    Row: EventRow,
{
    let Fetched {
        mut rows,
        page_info,
    } = fetched;
    rows.retain(|row| {
        !hydration
            .blocked_identities
            .contains(&row.as_event().identity)
            && !hydration.deletes_by_target.contains_key(&row.event_key())
    });
    Ok(Filtered { rows, page_info })
}

pub struct Filtered<Row, SortedBy> {
    pub rows: Vec<Row>,
    pub page_info: PageInfo<SortedBy>,
}
