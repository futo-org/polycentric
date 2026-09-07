use crate::data::{
    EventRow, EventWithContentRow, assemble_hint, row_into_hint,
};
use crate::service::context::RequestContext;
use crate::service::events::{TargetEventKey, tombstone};
use crate::service::feeds::repository::{self as feeds_repository};
use crate::service::graph::repository::Query as GraphRepository;
use crate::service::identity::service::{
    list_identity_events, list_profile_events,
};
use crate::service::stats::service::{EventStats, gather_stats_for};
use entity::{content_model, event_model};
use polycentric_common::models::protos_v2::content::ContentBody;
use polycentric_common::models::protos_v2::{
    Content, EventBundle, EventHint, EventKey,
};
use prost::Message;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tonic::Status;

#[derive(Default)]
pub struct HydrationState {
    pub deletes_by_target: HashMap<TargetEventKey, Vec<EventBundle>>,
    pub identity_events: Vec<EventWithContentRow>,
    pub profile_events: Vec<EventWithContentRow>,
    pub quote_post_events: Vec<EventWithContentRow>,
    pub repost_events: Vec<EventWithContentRow>,
    pub stats: EventStats,
    pub label_events: Vec<EventWithContentRow>,
    pub follow_events: Vec<EventWithContentRow>,
    /// Blocked identities for the authenticated caller. Empty for anonymous
    /// requests or pipelines where blocking is not applicable.
    pub blocked_identities: Arc<HashSet<String>>,
}

impl HydrationState {
    /// The hydrated identity-chain and profile rows as `EventHint`s, so
    /// clients can validate and render the referenced identities without
    /// extra queries.
    pub fn identity_profile_hints(self) -> Vec<EventHint> {
        self.identity_events
            .into_iter()
            .chain(self.profile_events)
            .map(row_into_hint)
            .collect()
    }

    /// # Notes
    ///
    /// Before calling this `deletes_by_target` and `blocked_identities` should
    /// be used to filter any rows that should be removed.
    ///
    /// Furthermore `stats` should be used when creating the bundles.
    pub fn into_hints(self) -> Vec<EventHint> {
        self.identity_events
            .into_iter()
            .chain(self.profile_events)
            .chain(self.quote_post_events)
            .chain(self.repost_events)
            .chain(self.label_events)
            .chain(self.follow_events)
            .map(|row| assemble_hint(row, &self.stats))
            .collect()
    }
}

/// Configuration for [`hydrate`]
///
/// Each boolean indicate whether or not the events relevant for the
/// [`ContentBody`] enum variant should be included.
#[derive(Default)]
pub struct HydrateConfig {
    post: bool,
    delete: bool,
    reaction: bool,
    repost: bool,
    report: bool,
    labels: bool,
    verification_verify: bool,
    verification_target: bool,
}

pub async fn hydrate<Row>(
    ctx: &RequestContext<'_>,
    rows: &[Row],
    config: &HydrateConfig,
) -> Result<HydrationState, Status>
where
    Row: EventRow,
{
    let keys: Vec<TargetEventKey> = rows
        .iter()
        .map(|row| TargetEventKey::of(row.as_event()))
        .collect();
    let (ref_keys, quote_set, repost_set) =
        collect_referenced_keys(rows, config);
    let mut target_event_keys = to_target_event_keys(&ref_keys);

    let identities = collect_identities(
        ctx.service.trusted_moderator.as_deref(),
        rows.iter(),
    );

    // Event keys for all referenced post events that may be displayed by the client.
    // Fetch labels and additional metadata for these.
    let display_keys: Vec<TargetEventKey> = {
        target_event_keys.extend(keys);
        target_event_keys.into_iter().collect()
    };

    let tombstones_fut =
        tombstone::validated_tombstones(ctx.service, &display_keys);
    let identity_events_fut =
        list_identity_events(ctx.service, identities.clone());
    let profile_events_fut = list_profile_events(ctx.service, identities);
    let referenced_fut = async {
        feeds_repository::Query::list_events_by_keys(
            &ctx.service.ro_db,
            &ref_keys,
        )
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "failed to list events");
            Status::internal("internal server error")
        })
    };
    let labels_fut = async {
        feeds_repository::Query::list_labels_for_event_keys(
            &ctx.service.ro_db,
            &display_keys,
            ctx.service.trusted_moderator.as_deref(),
        )
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "failed to list labels");
            Status::internal("internal server error")
        })
    };
    let stats_fut = async {
        gather_stats_for(
            &ctx.service.ro_db,
            rows.iter().map(|row| row.event_id()),
        )
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "failed to gather stats");
            Status::internal("internal server error")
        })
    };
    let blocked_fut = GraphRepository::blocked_set_for_caller(ctx);
    let (
        deletes_by_target,
        identity_events,
        profile_events,
        referenced,
        label_events,
        stats,
        blocked_identities,
    ) = tokio::try_join!(
        tombstones_fut,
        identity_events_fut,
        profile_events_fut,
        referenced_fut,
        labels_fut,
        stats_fut,
        blocked_fut,
    )?;

    let mut quote_post_events = Vec::new();
    let mut repost_events = Vec::new();
    for row in referenced {
        let key = TargetEventKey::of(&row.0);
        if quote_set.contains(&key) {
            quote_post_events.push(row);
        } else if repost_set.contains(&key) {
            repost_events.push(row);
        }
    }

    Ok(HydrationState {
        deletes_by_target,
        identity_events,
        profile_events,
        quote_post_events,
        repost_events,
        label_events,
        follow_events: Vec::new(),
        stats,
        blocked_identities,
    })
}

/// [`hydrate`] variant specifically for posts.
///
/// Return relevant content such as:
/// * Tombstones for the queried rows.
/// * Latest identity events (rotation/signing chain) for every identity
///   referenced.
/// * Latest profile event (display name / avatar / banner) for every identity
///   referenced.
pub async fn post_hydrate<Row>(
    ctx: &RequestContext<'_>,
    rows: &[Row],
) -> Result<HydrationState, Status>
where
    Row: EventRow,
{
    let config = HydrateConfig {
        post: true,
        delete: true,
        reaction: true,
        repost: true,
        report: false,
        labels: true,
        verification_verify: false,
        verification_target: false,
    };
    hydrate(ctx, rows, &config).await
}

/// Returns all event keys references in `rows`, as well as a set for the
/// quoutes and reposts.
fn collect_referenced_keys<Row>(
    rows: &[Row],
    config: &HydrateConfig,
) -> (
    Vec<EventKey>,
    HashSet<TargetEventKey>, // Quotes.
    HashSet<TargetEventKey>, // Reposts.
)
where
    Row: EventRow,
{
    let mut keys = Vec::with_capacity(rows.len());
    let mut push_key = |maybe_key: Option<EventKey>| {
        if let Some(key) = maybe_key {
            keys.push(key);
        }
    };
    let mut quote_set = HashSet::new();
    let mut repost_set = HashSet::new();
    for content in rows.iter().filter_map(EventRow::as_content) {
        let Ok(decoded) = Content::decode(content.serialized_bytes.as_slice())
        else {
            continue;
        };
        match decoded.content_body {
            Some(ContentBody::Post(post)) => {
                if !config.post {
                    continue;
                }

                if let Some(key) = post.quote.as_ref()
                    && let Some(key) = to_target_event_key(key)
                {
                    quote_set.insert(key);
                }
                push_key(post.quote);
                if let Some(reply) = post.reply {
                    push_key(reply.root);
                    push_key(reply.parent);
                }
            }
            Some(ContentBody::Delete(delete)) => {
                if !config.delete {
                    continue;
                }

                push_key(delete.event_key);
            }
            Some(ContentBody::Reaction(reaction)) => {
                if !config.reaction {
                    continue;
                }

                push_key(reaction.event_key);
            }
            Some(ContentBody::Repost(repost)) => {
                if !config.repost {
                    continue;
                }

                if let Some(key) = repost.post.as_ref()
                    && let Some(key) = to_target_event_key(key)
                {
                    repost_set.insert(key);
                }
                push_key(repost.post);
            }
            Some(ContentBody::Report(report)) => {
                if !config.report {
                    continue;
                }

                push_key(report.event_key);
            }
            Some(ContentBody::Labels(labels)) => {
                if !config.labels {
                    continue;
                }

                push_key(labels.event_key);
            }
            Some(ContentBody::VerificationVerify(verify)) => {
                if !config.verification_verify {
                    continue;
                }

                push_key(verify.claim_event_key);
            }
            Some(ContentBody::VerificationTarget(target)) => {
                if !config.verification_target {
                    continue;
                }

                push_key(target.claim_event_key);
            }
            // Don't have event keys.
            Some(ContentBody::Follow(_))
            | Some(ContentBody::Block(_))
            | Some(ContentBody::AttributedToReaction(_))
            | Some(ContentBody::ProfileUpdate(_))
            | Some(ContentBody::Identity(_))
            | Some(ContentBody::VerificationClaim(_))
            | None => {}
        }
    }
    (keys, quote_set, repost_set)
}

/// Convert proto `EventKey`s into [`TargetEventKey`]s, deduplicated into a set
/// for the membership tests that split the combined referenced-post result.
fn to_target_event_keys(keys: &[EventKey]) -> HashSet<TargetEventKey> {
    keys.iter().filter_map(to_target_event_key).collect()
}

/// Convert proto `EventKey`s into [`TargetEventKey`] (the shared comparable
/// EventKey shape).
pub fn to_target_event_key(key: &EventKey) -> Option<TargetEventKey> {
    let signed_by = key.signed_by.as_ref()?;
    Some(TargetEventKey {
        collection: key.collection as i16,
        identity: key.identity.clone(),
        public_key_type: signed_by.key_type as i16,
        public_key: signed_by.key.clone(),
        sequence: key.sequence as i64,
    })
}

pub fn collect_identities<Row>(
    trusted_moderator: Option<&str>,
    rows: impl Iterator<Item = Row>,
) -> Vec<String>
where
    Row: EventRow,
{
    let mut identities = HashSet::new();
    for row in rows {
        row.collect_identities(&mut identities);
    }

    // Add moderation service identity to every request, such that clients can
    // verify label events. This ships the identity events more times than the
    // client needs, and even when labels aren't present in the feed page -- can
    // be optimized later.
    if let Some(moderator) = trusted_moderator
        && !identities.is_empty()
    {
        identities.insert(moderator.to_owned());
    }

    identities.into_iter().collect()
}

pub fn event_identities(
    event: &event_model::Model,
    content: Option<&content_model::Model>,
    identities: &mut HashSet<String>,
) {
    identities.insert(event.identity.clone());
    if let Some(content) = content {
        let Ok(decoded) = Content::decode(content.serialized_bytes.as_slice())
        else {
            return;
        };
        match decoded.content_body {
            Some(ContentBody::Post(post)) => {
                if let Some(identity) =
                    post.reply.and_then(|r| r.parent).map(|p| p.identity)
                    && !identity.is_empty()
                {
                    identities.insert(identity);
                }
            }
            Some(ContentBody::Follow(follow)) => {
                if !follow.identity.is_empty() {
                    identities.insert(follow.identity);
                }
            }
            Some(ContentBody::Identity(identity)) => {
                identities.insert(identity.derive_hex_key());
            }
            Some(ContentBody::Repost(repost)) => {
                if let Some(post) = repost.post
                    && !post.identity.is_empty()
                {
                    identities.insert(post.identity);
                }
            }
            Some(ContentBody::VerificationTarget(target)) => {
                identities.extend(
                    target
                        .target_identities
                        .into_iter()
                        .filter(|identity| !identity.is_empty()),
                );
            }
            _ => {}
        }
    }
}
