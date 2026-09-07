//! `search_users`: searches users.

use crate::data::Marker;
use crate::data::hydration::{HydrationState, post_hydrate};
use crate::data::pipeline::{Fetched, create_pipeline, finalize_fetch};
use crate::service::context::RequestContext;
use crate::service::proto::{
    SearchUsersRequest, SearchUsersResponse, SortUsersBy,
};
use crate::service::search::repository::Query;
use crate::service::search::rpc::{
    self, SearchResponseFilter, SearchResponseView, SearchRow,
};
use serde::{Deserialize, Serialize};
use tonic::Status;

struct Params {
    common: rpc::Params<SortedUsersBy>,
    sort_by: SortUsersBy,
}

pub async fn handle(
    ctx: &RequestContext<'_>,
    req: SearchUsersRequest,
) -> Result<SearchUsersResponse, Status> {
    let sort_by = req.sort_by();
    let common = rpc::Params::from_req_params(req.query, &req.page_params)?;
    let params = Params { common, sort_by };
    let result =
        create_pipeline(ctx, &params, fetch, hydrate, filter, view).await?;
    Ok(SearchUsersResponse {
        results: result.results,
        event_hints: result.event_hints,
        page_info: Some(result.page_info.to_proto()?),
    })
}

async fn fetch(
    ctx: &RequestContext<'_>,
    params: &Params,
) -> Result<Fetched<SearchRow, SortedUsersBy>, Status> {
    let mut rows = Query::search_users(
        &ctx.service.ro_db,
        &params.common.query,
        params.sort_by,
        params.common.limit,
        params.common.cursor_filter.as_ref(),
    )
    .await?;
    let page_info = finalize_fetch(
        &mut rows,
        params.common.cursor_filter.as_ref(),
        params.common.limit as u32,
        |row| Marker {
            sorted_by: match params.sort_by {
                SortUsersBy::Default => SortedUsersBy::Rank(row.search_rank),
                SortUsersBy::Alpha => {
                    SortedUsersBy::Name(row.profile_name.clone())
                }
            },
            event_id: row.event.id,
        },
    );
    let rows = rows
        .into_iter()
        .map(|row| (row.event, row.content, row.search_rank))
        .collect();
    Ok(Fetched { rows, page_info })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum SortedUsersBy {
    /// ts_rank rank returned by Postgres.
    Rank(f32),
    Name(String),
}

impl SortedUsersBy {
    pub fn matches(&self, sort_by: SortUsersBy) -> bool {
        match self {
            SortedUsersBy::Rank(_) => sort_by == SortUsersBy::Default,
            SortedUsersBy::Name(_) => sort_by == SortUsersBy::Alpha,
        }
    }
}

async fn hydrate(
    ctx: &RequestContext<'_>,
    _params: &Params,
    fetched: &Fetched<SearchRow, SortedUsersBy>,
) -> Result<HydrationState, Status> {
    post_hydrate(ctx, &fetched.rows).await
}

async fn filter(
    _: &RequestContext<'_>,
    _params: &Params,
    fetched: Fetched<SearchRow, SortedUsersBy>,
    hydration: &HydrationState,
) -> Result<SearchResponseFilter<SortedUsersBy>, Status> {
    let omit_labels = &[];
    rpc::filter(fetched, hydration, omit_labels).await
}

async fn view(
    ctx: &RequestContext<'_>,
    _: &Params,
    filtered: SearchResponseFilter<SortedUsersBy>,
    hydration: HydrationState,
) -> Result<SearchResponseView<SortedUsersBy>, Status> {
    rpc::view(ctx.service, filtered, hydration).await
}
