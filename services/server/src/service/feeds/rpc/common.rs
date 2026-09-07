//! Common functions for feed rpc requests
//! Mostly pipeline related

use crate::data::hydration::{HydrationState, to_target_event_key};
use crate::data::{
    CursorFilter, EventWithContentRow, Marker, PageInfo, PaginationParams,
    assemble_bundles, assemble_hint, bundle_into_hint, pipeline,
};
use crate::service::context::ServiceContext;
use crate::service::events::TargetEventKey;
use crate::service::feeds::repository::EventCreatedAt;
use crate::service::proofs::service::attach_proofs;
use crate::service::proto::content::ContentBody;
use crate::service::proto::{Content, EventBundle, EventHint, PageParams};
use entity::content_model;
use prost::Message;
use serde::Deserialize;
use std::collections::HashSet;
use tonic::Status;

/// Common feed parameters needed for shared pagination logic in `finalize_fetch()`.
pub struct Params<SortedBy = EventCreatedAt> {
    pub limit: u64,
    pub cursor_filter: Option<CursorFilter<SortedBy>>,
    pub omit_labels: Vec<String>,
}

impl<SortedBy> Params<SortedBy> {
    /// Extract values from the client request's page params and `omit_labels` set.
    pub fn from_req_params(
        params: &Option<PageParams>,
        omit_labels: Vec<String>,
    ) -> Result<Params<SortedBy>, Status>
    where
        SortedBy: for<'a> Deserialize<'a>,
    {
        let PaginationParams {
            cursor_filter,
            limit,
        } = PaginationParams::from_req_params(params.as_ref())?;
        Ok(Params {
            limit: limit.into(),
            cursor_filter,
            omit_labels,
        })
    }
}

pub struct Fetched<SortedBy = EventCreatedAt> {
    pub rows: Vec<EventWithContentRow>,
    pub page_info: PageInfo<SortedBy>,
}

pub struct GetFeedResponseFilter<SortedBy = EventCreatedAt> {
    pub live_rows: Vec<EventWithContentRow>,
    pub tombstone_bundles: Vec<EventBundle>,
    pub event_hints: Vec<EventWithContentRow>,
    pub page_info: PageInfo<SortedBy>,
}

pub struct GetFeedResponseView<SortedBy = EventCreatedAt> {
    pub event_bundles: Vec<EventBundle>,
    pub event_hints: Vec<EventHint>,
    pub page_info: PageInfo<SortedBy>,
}

/// Remove any extra rows (for checking next page existence) and extract page info.
/// Return the final fetch stage result.
pub fn finalize_fetch(
    mut rows: Vec<EventWithContentRow>,
    params: &Params,
) -> Fetched {
    let page_info = pipeline::finalize_fetch(
        &mut rows,
        params.cursor_filter.as_ref(),
        params.limit as u32,
        create_event_created_at_marker,
    );
    Fetched { rows, page_info }
}

pub fn create_event_created_at_marker(
    (event, _): &EventWithContentRow,
) -> Marker<EventCreatedAt> {
    Marker {
        sorted_by: event.created_at,
        event_id: event.id,
    }
}

pub fn reply_parent(
    (_, content): &EventWithContentRow,
) -> Option<TargetEventKey> {
    let content = content.as_ref()?;
    let decoded = Content::decode(content.serialized_bytes.as_slice()).ok()?;
    match decoded.content_body {
        Some(ContentBody::Post(post)) => {
            to_target_event_key(post.reply?.parent.as_ref()?)
        }
        _ => None,
    }
}

/// Whether a row's content references another event as a quote or repost.
#[derive(Debug)]
pub enum Referenced {
    Quote(TargetEventKey),
    Repost(TargetEventKey),
}

/// Extract the referenced target key from a feed row, if any.
pub fn referenced_target(
    (_, content): &EventWithContentRow,
) -> Option<Referenced> {
    if let Some(content) = content.as_ref() {
        referenced_target2(content)
    } else {
        None
    }
}

pub fn referenced_target2(
    content: &content_model::Model,
) -> Option<Referenced> {
    let Ok(decoded) = Content::decode(content.serialized_bytes.as_slice())
    else {
        return None;
    };
    match decoded.content_body {
        Some(ContentBody::Post(post)) => post.quote.and_then(|key| {
            let sb = key.signed_by.as_ref()?;
            Some(Referenced::Quote(TargetEventKey {
                collection: key.collection as i16,
                identity: key.identity,
                public_key_type: sb.key_type as i16,
                public_key: sb.key.clone(),
                sequence: key.sequence as i64,
            }))
        }),
        Some(ContentBody::Repost(repost)) => repost.post.and_then(|key| {
            let sb = key.signed_by.as_ref()?;
            Some(Referenced::Repost(TargetEventKey {
                collection: key.collection as i16,
                identity: key.identity,
                public_key_type: sb.key_type as i16,
                public_key: sb.key.clone(),
                sequence: key.sequence as i64,
            }))
        }),
        _ => None,
    }
}

/// Returns `true` when `key` has at least one label whose value is in
/// `omit_label_set`.
pub fn has_matching_label(
    label_events: &[EventWithContentRow],
    key: &TargetEventKey,
    omit_label_set: &HashSet<&str>,
) -> bool {
    for label_row in label_events {
        if let Some(label_content) = &label_row.1
            && let Ok(content) =
                Content::decode(label_content.serialized_bytes.as_slice())
            && let Some(ContentBody::Labels(labels)) = content.content_body
            && let Some(lk) = labels.event_key
            && let Some(signed_by) = lk.signed_by
        {
            let label_key = TargetEventKey {
                collection: lk.collection as i16,
                identity: lk.identity,
                public_key_type: signed_by.key_type as i16,
                public_key: signed_by.key,
                sequence: lk.sequence as i64,
            };

            if label_key == *key {
                return labels
                    .label_values
                    .iter()
                    .any(|v| omit_label_set.contains(v.as_str()));
            }
        }
    }
    false
}

/// Remove rows that are blocked, tombstoned or omit-labeled, directly or
/// through their quote/repost target. Hint rows (referenced posts) are
/// filtered alongside live rows.
pub async fn filter<SortedBy>(
    fetched: Fetched<SortedBy>,
    hydration: &HydrationState,
    omit_labels: &[String],
) -> Result<GetFeedResponseFilter<SortedBy>, Status> {
    filter_rows(fetched, hydration, omit_labels, false).await
}

/// Drop blocked posts in a thread, along with all replies to those blocked posts.
pub async fn filter_thread<SortedBy>(
    fetched: Fetched<SortedBy>,
    hydration: &HydrationState,
    omit_labels: &[String],
) -> Result<GetFeedResponseFilter<SortedBy>, Status> {
    filter_rows(fetched, hydration, omit_labels, true).await
}

async fn filter_rows<SortedBy>(
    fetched: Fetched<SortedBy>,
    hydration: &HydrationState,
    omit_labels: &[String],
    cascade_blocked_replies: bool,
) -> Result<GetFeedResponseFilter<SortedBy>, Status> {
    let Fetched { rows, page_info } = fetched;
    let omit_set: HashSet<&str> =
        omit_labels.iter().map(|s| s.as_str()).collect();

    let is_omitted = |key: &TargetEventKey| -> bool {
        hydration.blocked_identities.contains(&key.identity)
            || hydration.deletes_by_target.contains_key(key)
            || (!omit_set.is_empty()
                && has_matching_label(&hydration.label_events, key, &omit_set))
    };

    let mut live_rows: Vec<EventWithContentRow> =
        Vec::with_capacity(rows.len());
    let mut tombstone_bundles: Vec<EventBundle> = Vec::new();
    let mut dropped_for_block: HashSet<TargetEventKey> = HashSet::new();

    // Filter live rows
    for row in rows {
        let key = TargetEventKey::of(&row.0);

        let cascades_from_dropped_parent = cascade_blocked_replies
            && reply_parent(&row)
                .is_some_and(|parent| dropped_for_block.contains(&parent));
        if hydration.blocked_identities.contains(&row.0.identity)
            || cascades_from_dropped_parent
        {
            dropped_for_block.insert(key);
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

        match referenced_target(&row) {
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

    Ok(GetFeedResponseFilter {
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
    filtered: GetFeedResponseFilter<SortedBy>,
    hydration: HydrationState,
) -> Result<GetFeedResponseView<SortedBy>, Status> {
    let GetFeedResponseFilter {
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

    let mut event_bundles = assemble_bundles(live_rows, &stats);

    let mut label_bundles = assemble_bundles(label_events, &stats);

    tokio::try_join!(
        attach_proofs(ctx, &mut event_bundles),
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

    Ok(GetFeedResponseView {
        event_bundles,
        event_hints,
        page_info,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::Cursor;
    use crate::service::proto::content::ContentBody;
    use crate::service::proto::{
        Content, EventBundle, EventKey, Labels, Post, PostReply, PublicKey,
        Repost,
    };
    use ::entity::content_model as ContentModel;
    use ::entity::event_model as EventModel;
    use chrono::DateTime;
    use sea_orm::prelude::DateTimeWithTimeZone;
    use std::collections::HashSet;
    use std::sync::Arc;

    fn ts(seconds: i64) -> DateTimeWithTimeZone {
        DateTime::from_timestamp_secs(seconds)
            .unwrap()
            .fixed_offset()
    }

    fn event_row(
        id: i64,
        identity: &str,
        collection: i16,
        sequence: i64,
    ) -> EventModel::Model {
        EventModel::Model {
            id,
            collection,
            identity: identity.to_string(),
            public_key_type: 1,
            public_key: vec![0xaa],
            sequence,
            content_digest_type: Some(1),
            content_digest_bytes: Some(vec![id as u8]),
            signature: vec![id as u8],
            previous_signature: vec![],
            previous_root: vec![],
            application_id: None,
            event_bytes: vec![id as u8],
            created_at: ts(id),
            synced_at: ts(id),
        }
    }

    fn content_row(id: i64, content: &Content) -> ContentModel::Model {
        ContentModel::Model {
            id,
            digest_type: 1,
            digest_bytes: vec![id as u8],
            serialized_bytes: content.encode_to_vec(),
            synced_at: ts(id),
        }
    }

    fn ewc(
        id: i64,
        identity: &str,
        collection: i16,
        sequence: i64,
        content: &Content,
    ) -> EventWithContentRow {
        (
            event_row(id, identity, collection, sequence),
            Some(content_row(id, content)),
        )
    }

    fn make_key(identity: &str, sequence: i64) -> TargetEventKey {
        TargetEventKey {
            collection: 2,
            identity: identity.to_string(),
            public_key_type: 1,
            public_key: vec![0xaa],
            sequence,
        }
    }

    fn to_event_key(target: &TargetEventKey) -> EventKey {
        EventKey {
            collection: target.collection as i32,
            identity: target.identity.clone(),
            signed_by: Some(PublicKey {
                key_type: target.public_key_type as i32,
                key: target.public_key.clone(),
            }),
            sequence: target.sequence as u64,
        }
    }

    fn make_label_event(
        target: &TargetEventKey,
        values: &[&str],
    ) -> EventWithContentRow {
        let content = Content {
            content_body: Some(ContentBody::Labels(Labels {
                event_key: Some(to_event_key(target)),
                label_values: values.iter().map(|s| s.to_string()).collect(),
            })),
        };
        ewc(999, "moderator", 1, 1, &content)
    }

    fn default_post_content() -> Content {
        Content {
            content_body: Some(ContentBody::Post(Post::default())),
        }
    }

    fn quote_content(target: &TargetEventKey) -> Content {
        Content {
            content_body: Some(ContentBody::Post(Post {
                quote: Some(to_event_key(target)),
                ..Default::default()
            })),
        }
    }

    fn repost_content(target: &TargetEventKey) -> Content {
        Content {
            content_body: Some(ContentBody::Repost(Repost {
                post: Some(to_event_key(target)),
            })),
        }
    }

    fn reply_content(parent: &TargetEventKey) -> Content {
        Content {
            content_body: Some(ContentBody::Post(Post {
                reply: Some(PostReply {
                    root: Some(to_event_key(parent)),
                    parent: Some(to_event_key(parent)),
                }),
                ..Default::default()
            })),
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

    fn live_identities(result: &GetFeedResponseFilter) -> Vec<String> {
        result
            .live_rows
            .iter()
            .map(|(event, _)| event.identity.clone())
            .collect()
    }

    fn make_fetched(rows: Vec<EventWithContentRow>) -> Fetched {
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

    #[test]
    fn has_matching_label_empty_list() {
        let key = make_key("alice", 1);
        let set: HashSet<&str> = ["spam"].into();
        assert!(!has_matching_label(&[], &key, &set));
    }

    #[test]
    fn has_matching_label_no_label_targets_key() {
        let key = make_key("alice", 1);
        let other = make_key("bob", 1);
        let labels = vec![make_label_event(&other, &["spam"])];
        let set: HashSet<&str> = ["spam"].into();
        assert!(!has_matching_label(&labels, &key, &set));
    }

    #[test]
    fn has_matching_label_value_not_in_omit_set() {
        let key = make_key("alice", 1);
        let labels = vec![make_label_event(&key, &["spam"])];
        let set: HashSet<&str> = ["hate"].into();
        assert!(!has_matching_label(&labels, &key, &set));
    }

    #[test]
    fn has_matching_label_value_matches() {
        let key = make_key("alice", 1);
        let labels = vec![make_label_event(&key, &["spam"])];
        let set: HashSet<&str> = ["spam"].into();
        assert!(has_matching_label(&labels, &key, &set));
    }

    #[test]
    fn has_matching_label_multiple_labels_one_matches() {
        let key = make_key("alice", 1);
        let labels = vec![make_label_event(&key, &["hate", "spam"])];
        let set: HashSet<&str> = ["spam"].into();
        assert!(has_matching_label(&labels, &key, &set));
    }

    #[test]
    fn has_matching_label_empty_omit_set() {
        let key = make_key("alice", 1);
        let labels = vec![make_label_event(&key, &["spam"])];
        let set: HashSet<&str> = HashSet::new();
        assert!(!has_matching_label(&labels, &key, &set));
    }

    #[test]
    fn referenced_target_no_content() {
        let row: EventWithContentRow = (event_row(1, "alice", 2, 1), None);
        assert!(referenced_target(&row).is_none());
    }

    #[test]
    fn referenced_target_non_post_repost_content() {
        let row = ewc(1, "alice", 2, 1, &Content::default());
        assert!(referenced_target(&row).is_none());
    }

    #[test]
    fn referenced_target_post_without_quote() {
        let row = ewc(1, "alice", 2, 1, &default_post_content());
        assert!(referenced_target(&row).is_none());
    }

    #[test]
    fn referenced_target_post_with_quote() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &quote_content(&target));
        let result = referenced_target(&row);
        match result {
            Some(Referenced::Quote(k)) => assert_eq!(k, target),
            other => panic!("expected Referenced::Quote, got {other:?}"),
        }
    }

    #[test]
    fn referenced_target_repost() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &repost_content(&target));
        let result = referenced_target(&row);
        match result {
            Some(Referenced::Repost(k)) => assert_eq!(k, target),
            other => panic!("expected Referenced::Repost, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn filter_clean_rows_pass_through() {
        let row = ewc(1, "alice", 2, 1, &default_post_content());
        let fetched = make_fetched(vec![row]);
        let hydration = HydrationState::default();
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(result.live_rows.len(), 1);
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_tombstoned_own_key() {
        let target = make_key("alice", 1);
        let row = ewc(1, "alice", 2, 1, &default_post_content());
        let mut hydration = HydrationState::default();
        hydration
            .deletes_by_target
            .insert(target, vec![EventBundle::default()]);
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert!(result.live_rows.is_empty());
        assert_eq!(result.tombstone_bundles.len(), 1);
    }

    #[tokio::test]
    async fn filter_omit_labeled_own_key() {
        let target = make_key("alice", 1);
        let row = ewc(1, "alice", 2, 1, &default_post_content());
        let labels = vec![make_label_event(&target, &["spam"])];
        let hydration = HydrationState {
            label_events: labels,
            ..Default::default()
        };
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &["spam".to_string()])
            .await
            .unwrap();
        assert!(result.live_rows.is_empty());
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_non_matching_label_keeps_row() {
        let key = make_key("alice", 1);
        let row = ewc(1, "alice", 2, 1, &default_post_content());
        let labels = vec![make_label_event(&key, &["spam"])];
        let hydration = HydrationState {
            label_events: labels,
            ..Default::default()
        };
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &["hate".to_string()])
            .await
            .unwrap();
        assert_eq!(result.live_rows.len(), 1);
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_empty_omit_labels_disables_label_filtering() {
        let key = make_key("alice", 1);
        let row = ewc(1, "alice", 2, 1, &default_post_content());
        let labels = vec![make_label_event(&key, &["spam"])];
        let hydration = HydrationState {
            label_events: labels,
            ..Default::default()
        };
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(result.live_rows.len(), 1);
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_repost_of_tombstoned_target() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &repost_content(&target));
        let mut hydration = HydrationState::default();
        hydration
            .deletes_by_target
            .insert(target, vec![EventBundle::default()]);
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert!(result.live_rows.is_empty());
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_repost_of_omit_labeled_target() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &repost_content(&target));
        let labels = vec![make_label_event(&target, &["spam"])];
        let hydration = HydrationState {
            label_events: labels,
            ..Default::default()
        };
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &["spam".to_string()])
            .await
            .unwrap();
        assert!(result.live_rows.is_empty());
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_repost_of_clean_target() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &repost_content(&target));
        let hydration = HydrationState::default();
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &["spam".to_string()])
            .await
            .unwrap();
        assert_eq!(result.live_rows.len(), 1);
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_quote_of_tombstoned_target() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &quote_content(&target));
        let mut hydration = HydrationState::default();
        hydration
            .deletes_by_target
            .insert(target, vec![EventBundle::default()]);
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(result.live_rows.len(), 1);
        assert_eq!(result.tombstone_bundles.len(), 1);
    }

    #[tokio::test]
    async fn filter_quote_of_omit_labeled_target() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &quote_content(&target));
        let labels = vec![make_label_event(&target, &["spam"])];
        let hydration = HydrationState {
            label_events: labels,
            ..Default::default()
        };
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &["spam".to_string()])
            .await
            .unwrap();
        assert_eq!(result.live_rows.len(), 1);
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_mixed_rows() {
        let clean = ewc(1, "alice", 2, 1, &default_post_content());
        let tombstoned = ewc(2, "bob", 2, 2, &default_post_content());
        let labeled = ewc(3, "charlie", 2, 3, &default_post_content());

        let mut hydration = HydrationState::default();
        hydration
            .deletes_by_target
            .insert(make_key("bob", 2), vec![EventBundle::default()]);
        hydration.label_events =
            vec![make_label_event(&make_key("charlie", 3), &["spam"])];

        let fetched = make_fetched(vec![clean, tombstoned, labeled]);
        let result = filter(fetched, &hydration, &["spam".to_string()])
            .await
            .unwrap();
        assert_eq!(result.live_rows.len(), 1);
        assert_eq!(
            TargetEventKey::of(&result.live_rows[0].0),
            make_key("alice", 1)
        );
        assert_eq!(result.tombstone_bundles.len(), 1);
    }

    #[tokio::test]
    async fn filter_hint_tombstoned_excluded() {
        let target = make_key("bob", 1);
        let hint = ewc(10, "bob", 2, 1, &default_post_content());
        let mut hydration = HydrationState::default();
        hydration
            .deletes_by_target
            .insert(target, vec![EventBundle::default()]);
        hydration.repost_events = vec![hint];
        let fetched = make_fetched(vec![]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert!(result.event_hints.is_empty());
    }

    #[tokio::test]
    async fn filter_hint_omit_labeled_excluded() {
        let target = make_key("bob", 1);
        let hint = ewc(10, "bob", 2, 1, &default_post_content());
        let hydration = HydrationState {
            label_events: vec![make_label_event(&target, &["spam"])],
            repost_events: vec![hint],
            ..Default::default()
        };
        let fetched = make_fetched(vec![]);
        let result = filter(fetched, &hydration, &["spam".to_string()])
            .await
            .unwrap();
        assert!(result.event_hints.is_empty());
    }

    #[tokio::test]
    async fn filter_hint_clean_included() {
        let hint = ewc(10, "bob", 2, 1, &default_post_content());
        let hydration = HydrationState {
            repost_events: vec![hint],
            ..Default::default()
        };
        let fetched = make_fetched(vec![]);
        let result = filter(fetched, &hydration, &["spam".to_string()])
            .await
            .unwrap();
        assert_eq!(result.event_hints.len(), 1);
    }

    #[test]
    fn reply_parent_of_non_reply_post() {
        let row = ewc(1, "alice", 2, 1, &default_post_content());
        assert!(reply_parent(&row).is_none());
    }

    #[test]
    fn reply_parent_of_reply() {
        let parent = make_key("bob", 1);
        let row = ewc(2, "alice", 2, 2, &reply_content(&parent));
        assert_eq!(reply_parent(&row), Some(parent));
    }

    #[tokio::test]
    async fn filter_blocked_author_dropped() {
        let row = ewc(1, "bob", 2, 1, &default_post_content());
        let fetched = make_fetched(vec![row]);
        let hydration = blocking(&["bob"]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert!(result.live_rows.is_empty());
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_unblocked_author_kept() {
        let row = ewc(1, "alice", 2, 1, &default_post_content());
        let fetched = make_fetched(vec![row]);
        let hydration = blocking(&["bob"]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(result.live_rows.len(), 1);
    }

    #[tokio::test]
    async fn filter_blocked_author_brings_no_tombstone_hint() {
        let target = make_key("bob", 1);
        let row = ewc(1, "bob", 2, 1, &default_post_content());
        let mut hydration = blocking(&["bob"]);
        hydration
            .deletes_by_target
            .insert(target, vec![EventBundle::default()]);
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert!(result.live_rows.is_empty());
        assert!(result.tombstone_bundles.is_empty());
    }

    #[tokio::test]
    async fn filter_repost_of_blocked_author_dropped() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &repost_content(&target));
        let hydration = blocking(&["bob"]);
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert!(result.live_rows.is_empty());
    }

    #[tokio::test]
    async fn filter_quote_of_blocked_author_kept() {
        let target = make_key("bob", 1);
        let row = ewc(1, "alice", 2, 1, &quote_content(&target));
        let hydration = blocking(&["bob"]);
        let fetched = make_fetched(vec![row]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(result.live_rows.len(), 1);
    }

    #[tokio::test]
    async fn filter_hint_by_blocked_author_excluded() {
        let hint = ewc(10, "bob", 2, 1, &default_post_content());
        let hydration = HydrationState {
            repost_events: vec![hint],
            ..blocking(&["bob"])
        };
        let fetched = make_fetched(vec![]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert!(result.event_hints.is_empty());
    }

    #[tokio::test]
    async fn filter_blocked_reply_cascades_to_unblocked_descendants() {
        let alice_root = ewc(1, "alice", 2, 1, &default_post_content());
        let bob_reply =
            ewc(2, "bob", 2, 2, &reply_content(&make_key("alice", 1)));
        let charlie_reply =
            ewc(3, "charlie", 2, 3, &reply_content(&make_key("bob", 2)));
        let dave_reply =
            ewc(4, "dave", 2, 4, &reply_content(&make_key("charlie", 3)));

        let fetched = make_fetched(vec![
            alice_root,
            bob_reply,
            charlie_reply,
            dave_reply,
        ]);
        let hydration = blocking(&["bob"]);
        let result = filter_thread(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(live_identities(&result), vec!["alice".to_string()]);
    }

    #[tokio::test]
    async fn filter_does_not_cascade_outside_threads() {
        let bob_post = ewc(1, "bob", 2, 1, &default_post_content());
        let charlie_reply =
            ewc(2, "charlie", 2, 2, &reply_content(&make_key("bob", 1)));

        let fetched = make_fetched(vec![bob_post, charlie_reply]);
        let hydration = blocking(&["bob"]);
        let result = filter(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(live_identities(&result), vec!["charlie".to_string()]);
    }

    #[tokio::test]
    async fn filter_blocked_reply_leaves_sibling_branch_intact() {
        let alice_root = ewc(1, "alice", 2, 1, &default_post_content());
        let bob_reply =
            ewc(2, "bob", 2, 2, &reply_content(&make_key("alice", 1)));
        let erin_reply =
            ewc(3, "erin", 2, 3, &reply_content(&make_key("alice", 1)));

        let fetched = make_fetched(vec![alice_root, bob_reply, erin_reply]);
        let hydration = blocking(&["bob"]);
        let result = filter_thread(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(
            live_identities(&result),
            vec!["alice".to_string(), "erin".to_string()]
        );
    }

    #[tokio::test]
    async fn filter_blocked_ancestor_empties_thread() {
        let bob_root = ewc(1, "bob", 2, 1, &default_post_content());
        let alice_subject =
            ewc(2, "alice", 2, 2, &reply_content(&make_key("bob", 1)));
        let charlie_reply =
            ewc(3, "charlie", 2, 3, &reply_content(&make_key("alice", 2)));

        let fetched =
            make_fetched(vec![bob_root, alice_subject, charlie_reply]);
        let hydration = blocking(&["bob"]);
        let result = filter_thread(fetched, &hydration, &[]).await.unwrap();
        assert!(result.live_rows.is_empty());
    }

    #[tokio::test]
    async fn filter_block_cascade_requires_parent_before_child() {
        let charlie_reply =
            ewc(3, "charlie", 2, 3, &reply_content(&make_key("bob", 2)));
        let bob_reply =
            ewc(2, "bob", 2, 2, &reply_content(&make_key("alice", 1)));

        let fetched = make_fetched(vec![charlie_reply, bob_reply]);
        let hydration = blocking(&["bob"]);
        let result = filter_thread(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(live_identities(&result), vec!["charlie".to_string()]);
    }

    #[tokio::test]
    async fn filter_cascade_does_not_extend_to_tombstoned_parents() {
        let alice_root = ewc(1, "alice", 2, 1, &default_post_content());
        let charlie_reply =
            ewc(2, "charlie", 2, 2, &reply_content(&make_key("alice", 1)));

        let mut hydration = blocking(&["bob"]);
        hydration
            .deletes_by_target
            .insert(make_key("alice", 1), vec![EventBundle::default()]);

        let fetched = make_fetched(vec![alice_root, charlie_reply]);
        let result = filter_thread(fetched, &hydration, &[]).await.unwrap();
        assert_eq!(live_identities(&result), vec!["charlie".to_string()]);
    }
}
