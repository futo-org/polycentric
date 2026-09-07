//! `list_bans`: a paginated, optionally filtered list of the identities
//! banned on this server. Requires the caller to be a moderator.

use crate::service::context::ServiceContext;
use crate::service::identity::repository::{self as id_repo, BanCursor};
use crate::service::identity::rpc::common::require_moderator;
use crate::service::proto::{ListBansRequest, ListBansResponse, PageInfo};
use ::entity::ban_model;
use chrono::DateTime;
use tonic::{Request, Status};

const DEFAULT_LIMIT: u32 = 10;
const MAX_LIMIT: u32 = 200;

pub async fn handle(
    ctx: &ServiceContext,
    request: Request<ListBansRequest>,
) -> Result<ListBansResponse, Status> {
    require_moderator(ctx, &request).await?;

    let body = request.into_inner();

    let limit = body.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as u64;

    let after = match body.after.as_deref() {
        None | Some("") => None,
        Some(cursor) => Some(decode_cursor(cursor)?),
    };

    // Identities are lowercase hex, so lowercasing the query makes the
    // prefix match effectively case-insensitive.
    let query = body
        .query
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(str::to_lowercase);

    // A query with any non-hex character can't be the prefix of a (hex)
    // identity, so short-circuit to an empty page. This also keeps LIKE
    // metacharacters (`_`, `%`, `\`) from reaching the query as wildcards.
    if let Some(q) = &query
        && !q.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Ok(ListBansResponse {
            banned_identities: Vec::new(),
            page_info: Some(PageInfo {
                start_cursor: String::new(),
                end_cursor: String::new(),
                has_previous_page: after.is_some(),
                has_next_page: false,
            }),
        });
    }

    // Over-fetch one to detect a following page.
    let mut rows = id_repo::Query::list_bans(
        &ctx.ro_db,
        limit + 1,
        after.as_ref(),
        query.as_deref(),
    )
    .await
    .map_err(|_| Status::internal("internal server error"))?;

    let has_next_page = rows.len() > limit as usize;
    rows.truncate(limit as usize);

    let start_cursor = rows.first().map(encode_cursor).unwrap_or_default();
    let end_cursor = rows.last().map(encode_cursor).unwrap_or_default();

    Ok(ListBansResponse {
        banned_identities: rows.into_iter().map(|r| r.identity).collect(),
        page_info: Some(PageInfo {
            start_cursor,
            end_cursor,
            has_previous_page: after.is_some(),
            has_next_page,
        }),
    })
}

/// Cursor is `<created_at_micros>:<identity>`; identities are hex so the
/// first `:` unambiguously separates the two parts.
fn encode_cursor(row: &ban_model::Model) -> String {
    format!("{}:{}", row.created_at.timestamp_micros(), row.identity)
}

fn decode_cursor(cursor: &str) -> Result<BanCursor, Status> {
    let (micros, identity) = cursor
        .split_once(':')
        .ok_or_else(|| Status::invalid_argument("invalid cursor"))?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| Status::invalid_argument("invalid cursor"))?;
    let created_at = DateTime::from_timestamp_micros(micros)
        .ok_or_else(|| Status::invalid_argument("invalid cursor"))?;
    Ok(BanCursor {
        created_at,
        identity: identity.to_string(),
    })
}
