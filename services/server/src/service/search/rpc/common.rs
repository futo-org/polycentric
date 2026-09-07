use crate::data::hydration::HydrationState;
use crate::data::pipeline::Fetched;
use crate::data::{
    CursorFilter, EventRow, EventWithContentRow, PageInfo, PaginationParams,
    assemble_bundle, assemble_bundles, assemble_hint, bundle_into_hint,
};
use crate::service::context::ServiceContext;
use crate::service::events::TargetEventKey;
use crate::service::feeds::rpc::common::{
    Referenced, has_matching_label, referenced_target2,
};
use crate::service::proofs::service::attach_proofs;
use crate::service::proto::{EventBundle, EventHint, PageParams, SearchResult};
use crate::service::stats::service::EventStats;
use entity::{content_model, event_model};
use serde::Deserialize;
use std::collections::HashSet;
use tonic::Status;

// TODO: dedup with the logic in `src/service/feeds/rpc/common.rs`, a lot of it
// is the same, but the types are slightly different. We could unify it and move
// it to the data/pipeline module.

pub struct Params<SortedBy> {
    pub query: String,
    pub limit: u64,
    pub cursor_filter: Option<CursorFilter<SortedBy>>,
}

impl<SortedBy> Params<SortedBy> {
    pub fn from_req_params(
        query: String,
        params: &Option<PageParams>,
    ) -> Result<Params<SortedBy>, Status>
    where
        SortedBy: for<'a> Deserialize<'a>,
    {
        let query = prepare_search_query(&query)
            .ok_or_else(|| Status::invalid_argument("empty search query"))?;
        let PaginationParams {
            cursor_filter,
            limit,
        } = PaginationParams::from_req_params(params.as_ref())?;
        Ok(Params {
            query,
            limit: limit.into(),
            cursor_filter,
        })
    }
}

/// Construct a search query from a user defined `query` to use in
/// `search_query`.
fn prepare_search_query(search_query: &str) -> Option<String> {
    let search_query = search_query.trim();
    if search_query.is_empty() {
        return None;
    }

    // There is propably a more performant way we can do these query
    // transformations. But in most cases the query will be quite short, so it's
    // not really worth spending too much time on.
    // It's left as an "exercise to reader". ;)
    let mut result = String::with_capacity(search_query.len() * 2);
    let mut in_quote = false;
    for c in search_query.chars() {
        match c {
            '\"' => {
                in_quote = !in_quote;
                result.push(c);
            }
            c if c.is_whitespace()
                // Characters to escape, we convert them into whitespace.
                || matches!(c, ':' | '&' | '|' | '!' | '<' | '>' | '(' | ')') =>
            {
                // Ignore whitespace or to-be-escaped characters at the start.
                if result.is_empty() {
                    continue;
                }

                if in_quote {
                    // Words connected with `+` (followed by an operator) get the prefix
                    // matching (`:*`) applied to allow connected works, e.g.
                    // `New+York:*` becomes `'new':* <-> 'york':*`.
                    if !result.ends_with('+') {
                        result.push('+');
                    }
                } else {
                    // `:*` is for prefix matching of the word. `&` for "and" matching,
                    // i.e. match both search terms.
                    if !result.ends_with(":*&") {
                        result.push_str(":*&");
                    }
                }
            }
            c => result.push(c),
        }
    }
    // Remove last +/& as we don't need to join any more words.
    if result.ends_with('+') || result.ends_with('&') {
        result.pop();
    }
    if !result.ends_with(":*") && !result.is_empty() {
        result.push_str(":*");
    }
    Some(result)
}

#[test]
fn test_prepare_search_query() {
    let tests = [
        ("York", Some("York:*")),
        ("New York", Some("New:*&York:*")),
        ("\"New York\"", Some("\"New+York\":*")),
        ("\"New\" York", Some("\"New\":*&York:*")),
        ("New \"York\"", Some("New:*&\"York\":*")),
        ("\"New York", Some("\"New+York:*")),
        ("New York\"", Some("New:*&York\":*")),
        ("author:Sparrow", Some("author:*&Sparrow:*")),
        ("creator::Sparrow", Some("creator:*&Sparrow:*")),
        (
            "initialize_solana_accounts()",
            Some("initialize_solana_accounts:*"),
        ),
        ("openV<", Some("openV:*")),
        ("", None),
        (" ", None),
        ("  ", None),
        ("\t", None),
    ];

    for (input, expected) in tests {
        let got = prepare_search_query(input);
        assert_eq!(got.as_deref(), expected, "input: {input}");
    }
}

/// Event, content and search rank.
pub type SearchRow = (event_model::Model, content_model::Model, f32);

impl EventRow for SearchRow {
    fn as_event_with_content(
        &self,
    ) -> (&event_model::Model, Option<&content_model::Model>) {
        (&self.0, Some(&self.1))
    }

    fn as_event(&self) -> &event_model::Model {
        &self.0
    }

    fn as_content(&self) -> Option<&content_model::Model> {
        Some(&self.1)
    }
}

pub struct SearchResponseFilter<SortedBy> {
    pub live_rows: Vec<SearchRow>,
    pub tombstone_bundles: Vec<EventBundle>,
    pub event_hints: Vec<EventWithContentRow>,
    pub page_info: PageInfo<SortedBy>,
}

/// Remove rows that are blocked, tombstoned or omit-labeled, directly or
/// through their quote/repost target. Hint rows (referenced posts) are
/// filtered alongside live rows.
pub async fn filter<SortedBy>(
    fetched: Fetched<SearchRow, SortedBy>,
    hydration: &HydrationState,
    omit_labels: &[String],
) -> Result<SearchResponseFilter<SortedBy>, Status> {
    let Fetched { rows, page_info } = fetched;
    let omit_set: HashSet<&str> =
        omit_labels.iter().map(|s| s.as_str()).collect();

    let is_omitted = |key: &TargetEventKey| -> bool {
        hydration.blocked_identities.contains(&key.identity)
            || hydration.deletes_by_target.contains_key(key)
            || (!omit_set.is_empty()
                && has_matching_label(&hydration.label_events, key, &omit_set))
    };

    let mut live_rows: Vec<SearchRow> = Vec::with_capacity(rows.len());
    let mut tombstone_bundles: Vec<EventBundle> = Vec::new();

    // Filter live rows
    for row in rows {
        let key = TargetEventKey::of(&row.0);

        if hydration.blocked_identities.contains(&row.0.identity) {
            continue;
        }

        // If tombstoned, drop but add a hint
        if let Some(bundles) = hydration.deletes_by_target.get(&key) {
            tombstone_bundles.extend(bundles.iter().cloned());
            continue;
        }

        // If omit-labeled, drop
        if !omit_set.is_empty()
            && has_matching_label(&hydration.label_events, &key, &omit_set)
        {
            continue;
        }

        match referenced_target2(&row.1) {
            // If repost of deleted/omitted target, drop
            Some(Referenced::Repost(target)) if is_omitted(&target) => {
                continue;
            }
            // If quote of deleted/omitted target, allow and bring tombstone bundle if it exists
            Some(Referenced::Quote(target)) => {
                if let Some(bundles) = hydration.deletes_by_target.get(&target)
                {
                    tombstone_bundles.extend(bundles.iter().cloned());
                }
            }
            _ => {}
        }

        live_rows.push(row);
    }

    // Filter hint rows
    let event_hints: Vec<EventWithContentRow> = hydration
        .quote_post_events
        .iter()
        .chain(hydration.repost_events.iter())
        .filter(|row| {
            let key = TargetEventKey::of(&row.0);
            !is_omitted(&key)
        })
        .cloned()
        .collect();

    Ok(SearchResponseFilter {
        live_rows,
        tombstone_bundles,
        event_hints,
        page_info,
    })
}

/// Build bundles from live rows, attach revocation proofs, and merge
/// identity, profile and tombstone hints.
pub async fn view<SortedBy>(
    ctx: &ServiceContext,
    filtered: SearchResponseFilter<SortedBy>,
    hydration: HydrationState,
) -> Result<SearchResponseView<SortedBy>, Status> {
    let SearchResponseFilter {
        live_rows,
        mut tombstone_bundles,
        event_hints,
        page_info,
    } = filtered;
    let HydrationState {
        identity_events,
        profile_events,
        label_events,
        stats,
        ..
    } = hydration;

    let mut results = assemble_results(live_rows, &stats);
    // SAFETY: we've just assembled the result above where the event_bundle is
    // always Some, hence it's safe to unwrap.
    let results_iter = results
        .iter_mut()
        .map(|result| result.event_bundle.as_mut().unwrap());

    let mut label_bundles = assemble_bundles(label_events, &stats);

    tokio::try_join!(
        attach_proofs(ctx, results_iter),
        attach_proofs(ctx, &mut tombstone_bundles),
        attach_proofs(ctx, &mut label_bundles),
    )?;

    // Identity, profile, referenced (quote / repost) posts, tombstones,
    // and moderation labels all ship as hints.
    let mut event_hints = identity_events
        .into_iter()
        .chain(profile_events)
        .chain(event_hints)
        .map(|row| assemble_hint(row, &stats))
        .collect::<Vec<_>>();

    event_hints.extend(tombstone_bundles.into_iter().map(bundle_into_hint));
    event_hints.extend(label_bundles.into_iter().map(bundle_into_hint));

    Ok(SearchResponseView {
        results,
        event_hints,
        page_info,
    })
}

/// Create event bundles with metadata.
pub fn assemble_results(
    rows: Vec<SearchRow>,
    stats: &EventStats,
) -> Vec<SearchResult> {
    rows.into_iter()
        .map(|(event, content, rank)| {
            let event = assemble_bundle((event, Some(content)), stats);
            SearchResult {
                event_bundle: Some(event),
                rank,
            }
        })
        .collect::<Vec<_>>()
}

pub struct SearchResponseView<SortedBy> {
    pub results: Vec<SearchResult>,
    pub event_hints: Vec<EventHint>,
    pub page_info: PageInfo<SortedBy>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::Cursor;
    use crate::service::proto::content::ContentBody;
    use crate::service::proto::{Content, EventKey, Post, PublicKey, Repost};
    use chrono::DateTime;
    use prost::Message;
    use sea_orm::prelude::DateTimeWithTimeZone;
    use std::sync::Arc;

    fn now() -> DateTimeWithTimeZone {
        DateTime::from_timestamp(0, 0).unwrap().fixed_offset()
    }

    fn search_row(id: i64, identity: &str, content: &Content) -> SearchRow {
        (
            event_model::Model {
                id,
                collection: 2,
                identity: identity.to_string(),
                public_key_type: 1,
                public_key: vec![0xaa],
                sequence: id,
                content_digest_type: Some(1),
                content_digest_bytes: Some(vec![id as u8]),
                signature: vec![id as u8],
                previous_signature: vec![],
                previous_root: vec![],
                application_id: None,
                event_bytes: vec![id as u8],
                created_at: now(),
                synced_at: now(),
            },
            content_model::Model {
                id,
                digest_type: 1,
                digest_bytes: vec![id as u8],
                serialized_bytes: content.encode_to_vec(),
                synced_at: now(),
            },
            1.0,
        )
    }

    fn post_content() -> Content {
        Content {
            content_body: Some(ContentBody::Post(Post::default())),
        }
    }

    fn repost_content(target_identity: &str, sequence: u64) -> Content {
        Content {
            content_body: Some(ContentBody::Repost(Repost {
                post: Some(EventKey {
                    collection: 2,
                    identity: target_identity.to_string(),
                    signed_by: Some(PublicKey {
                        key_type: 1,
                        key: vec![0xaa],
                    }),
                    sequence,
                }),
            })),
        }
    }

    fn fetched(rows: Vec<SearchRow>) -> Fetched<SearchRow, ()> {
        Fetched {
            rows,
            page_info: PageInfo {
                backward_cursor: Cursor::End,
                forward_cursor: Cursor::End,
                has_previous_page: false,
                has_next_page: false,
            },
        }
    }

    fn blocking(identities: &[&str]) -> HydrationState {
        HydrationState {
            blocked_identities: Arc::new(
                identities.iter().map(|s| s.to_string()).collect(),
            ),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn filter_blocked_author_dropped() {
        let rows = vec![
            search_row(1, "bob", &post_content()),
            search_row(2, "alice", &post_content()),
        ];
        let hydration = blocking(&["bob"]);
        let result = filter(fetched(rows), &hydration, &[]).await.unwrap();
        let identities: Vec<&str> = result
            .live_rows
            .iter()
            .map(|(event, _, _)| event.identity.as_str())
            .collect();
        assert_eq!(identities, ["alice"]);
    }

    #[tokio::test]
    async fn filter_repost_of_blocked_author_dropped() {
        let rows = vec![search_row(1, "alice", &repost_content("bob", 1))];
        let hydration = blocking(&["bob"]);
        let result = filter(fetched(rows), &hydration, &[]).await.unwrap();
        assert!(result.live_rows.is_empty());
    }

    #[tokio::test]
    async fn filter_hint_by_blocked_author_excluded() {
        let hint = (
            search_row(10, "bob", &post_content()).0,
            Some(search_row(10, "bob", &post_content()).1),
        );
        let hydration = HydrationState {
            repost_events: vec![hint],
            ..blocking(&["bob"])
        };
        let result = filter(fetched(vec![]), &hydration, &[]).await.unwrap();
        assert!(result.event_hints.is_empty());
    }

    #[tokio::test]
    async fn filter_without_blocks_keeps_every_row() {
        let rows = vec![
            search_row(1, "bob", &post_content()),
            search_row(2, "alice", &post_content()),
        ];
        let hydration = HydrationState::default();
        let result = filter(fetched(rows), &hydration, &[]).await.unwrap();
        assert_eq!(result.live_rows.len(), 2);
    }
}
