use crate::data::{
    EventWithContentRow, assemble_hint, bundle_into_hint, pipeline,
    rows_into_bundles,
};
use crate::service::{
    context::RequestContext,
    events::TargetEventKey,
    feeds::{
        repository::Query as FeedsRepository, rpc::common::has_matching_label,
        util::map_db_err,
    },
    graph::repository::Query as GraphRepository,
    identity::service::{list_identity_events, list_profile_events},
    notifications::repository::Query as NotificationRepository,
    proofs::service::attach_proofs,
    proto::{
        EventBundle, EventHint, EventKey, ListNotificationsRequest,
        ListNotificationsResponse, Notification, PageInfo, PublicKey,
    },
    stats::service::gather_stats_for,
};
use ::entity::notification;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tonic::Status;

const DEFAULT_LIMIT: u32 = 50;
const MAX_LIMIT: u32 = 200;
struct Params {
    identity: String,
    limit: u64,
    after_id: Option<i64>,
    omit_labels: Vec<String>,
}

pub struct Fetched {
    pub rows: Vec<notification::Model>,
    pub has_next_page: bool,
    pub has_previous_page: bool,
}

struct Hydrated {
    bundles: HashMap<TargetEventKey, EventBundle>,
    /// Identity, profile, and moderation label events for every identity involved.
    event_hints: Vec<EventHint>,
    /// Label events targeting the page's trigger events, for `filter`.
    trigger_labels: Vec<EventWithContentRow>,
    blocked_identities: Arc<HashSet<String>>,
}

pub async fn handle(
    ctx: &RequestContext<'_>,
    req: ListNotificationsRequest,
) -> Result<ListNotificationsResponse, Status> {
    if req.identity.is_empty() {
        return Err(Status::invalid_argument("identity is required"));
    }

    // The cursor is the stringified id of the last notification from the
    // previous page.
    let after_id = match req.after.as_deref() {
        None | Some("") => None,
        Some(cursor) => Some(
            cursor
                .parse::<i64>()
                .map_err(|_| Status::invalid_argument("invalid cursor"))?,
        ),
    };

    let limit = req.first.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as u64;

    let params = Params {
        identity: req.identity,
        limit,
        after_id,
        omit_labels: req.omit_labels,
    };

    pipeline::create_pipeline(ctx, &params, fetch, hydrate, filter, view).await
}

async fn fetch(
    ctx: &RequestContext<'_>,
    params: &Params,
) -> Result<Fetched, Status> {
    let raw = NotificationRepository::list_for_identity(
        &ctx.service.ro_db,
        &params.identity,
        params.limit + 1, // over-fetch for pagination
        params.after_id,
    )
    .await
    .map_err(map_db_err)?;

    let has_next_page = raw.len() > params.limit as usize;
    let rows: Vec<notification::Model> =
        raw.into_iter().take(params.limit as usize).collect();

    Ok(Fetched {
        rows,
        has_next_page,
        has_previous_page: params.after_id.is_some(),
    })
}

async fn hydrate(
    ctx: &RequestContext<'_>,
    _params: &Params,
    fetched: &Fetched,
) -> Result<Hydrated, Status> {
    let rows = &fetched.rows;
    // Every trigger (and present target) event the page references, plus the
    // identities involved.
    let mut cmp_keys: Vec<TargetEventKey> = Vec::new();
    let mut trigger_keys: Vec<TargetEventKey> = Vec::new();
    let mut identities: HashSet<String> = HashSet::new();
    for row in rows {
        let trigger_key = trigger_key(row);
        trigger_keys.push(trigger_key.clone());
        cmp_keys.push(trigger_key);
        if let Some(target) = target_key(row) {
            cmp_keys.push(target);
        }
        identities.insert(row.from_identity.clone());
        identities.insert(row.to_identity.clone());
    }

    // Bulk-fetch the referenced events, build bundles with proofs, and index
    // them by their comparable key for the view stage.
    let proto_keys: Vec<EventKey> = cmp_keys.iter().map(to_proto_key).collect();
    let fetched =
        FeedsRepository::list_events_by_keys(&ctx.service.ro_db, &proto_keys)
            .await
            .map_err(map_db_err)?;

    let stats_fut = async {
        gather_stats_for(&ctx.service.ro_db, fetched.iter().map(|(e, _)| e.id))
            .await
            .map_err(map_db_err)
    };

    // Fetch label events for trigger events only: we assume recipient is the target's
    // author and does not object to their own posts.
    let label_fut = async {
        FeedsRepository::list_labels_for_event_keys(
            &ctx.service.ro_db,
            &trigger_keys,
            ctx.service.trusted_moderator.as_deref(),
        )
        .await
        .map_err(map_db_err)
    };

    // Add moderation service identity to every request, such that clients can verify label events.
    // This ships the identity events more times than the client needs, and even when labels aren't
    // present in the feed page--can be optimized later.
    if let Some(moderator) = &ctx.service.trusted_moderator
        && !identities.is_empty()
    {
        identities.insert(moderator.clone());
    }

    let identities: Vec<String> = identities.into_iter().collect();

    let blocked_fut = GraphRepository::blocked_set_for_caller(ctx);

    // Author identity, profile, and moderation label events all ship as hints.
    let (identity_events, profile_events, label_rows, stats, blocked) = tokio::try_join!(
        list_identity_events(ctx.service, identities.clone()),
        list_profile_events(ctx.service, identities),
        label_fut,
        stats_fut,
        blocked_fut,
    )?;

    let fetched_keys: Vec<_> =
        fetched.iter().map(|(e, _)| TargetEventKey::of(e)).collect();
    let mut fetched_bundles = rows_into_bundles(fetched);
    attach_proofs(ctx.service, &mut fetched_bundles).await?;

    let bundles: HashMap<TargetEventKey, EventBundle> =
        fetched_keys.into_iter().zip(fetched_bundles).collect();

    let mut label_bundles = rows_into_bundles(label_rows.clone());
    attach_proofs(ctx.service, &mut label_bundles).await?;

    let mut event_hints = identity_events
        .into_iter()
        .chain(profile_events)
        .map(|row| assemble_hint(row, &stats))
        .collect::<Vec<_>>();

    event_hints.extend(label_bundles.into_iter().map(bundle_into_hint));

    Ok(Hydrated {
        bundles,
        event_hints,
        trigger_labels: label_rows,
        blocked_identities: blocked,
    })
}

async fn filter(
    _ctx: &RequestContext<'_>,
    params: &Params,
    fetched: Fetched,
    hydrated: &Hydrated,
) -> Result<Fetched, Status> {
    let Fetched {
        mut rows,
        has_next_page,
        has_previous_page,
    } = fetched;

    let omit_set: HashSet<&str> =
        params.omit_labels.iter().map(|s| s.as_str()).collect();

    let is_omit_labeled = |row: &notification::Model| {
        !omit_set.is_empty()
            && has_matching_label(
                &hydrated.trigger_labels,
                &trigger_key(row),
                &omit_set,
            )
    };

    rows.retain(|row| {
        !hydrated.blocked_identities.contains(&row.from_identity)
            && !is_omit_labeled(row)
    });

    Ok(Fetched {
        rows,
        has_next_page,
        has_previous_page,
    })
}

async fn view(
    _ctx: &RequestContext<'_>,
    _params: &Params,
    fetched: Fetched,
    hydrated: Hydrated,
) -> Result<ListNotificationsResponse, Status> {
    let Fetched {
        rows,
        has_next_page,
        has_previous_page,
    } = fetched;
    let Hydrated {
        bundles,
        event_hints,
        ..
    } = hydrated;
    let start_cursor =
        rows.first().map(|r| r.id.to_string()).unwrap_or_default();
    let end_cursor = rows.last().map(|r| r.id.to_string()).unwrap_or_default();

    let notifications = rows
        .into_iter()
        .filter_map(|row| {
            // Drop a notification whose trigger event we can no longer
            // resolve (e.g. it was deleted).
            let trigger_event = Some(bundles.get(&trigger_key(&row)).cloned()?);
            let target_event =
                target_key(&row).and_then(|key| bundles.get(&key).cloned());
            Some(Notification {
                trigger_event,
                target_event,
                kind: row.kind,
            })
        })
        .collect();

    Ok(ListNotificationsResponse {
        notifications,
        event_hints,
        page_info: Some(PageInfo {
            start_cursor,
            end_cursor,
            has_next_page,
            has_previous_page,
        }),
    })
}

/// The trigger event's comparable key (always present).
fn trigger_key(row: &notification::Model) -> TargetEventKey {
    TargetEventKey {
        collection: row.trigger_event_key_collection,
        identity: row.trigger_event_key_identity.clone(),
        public_key_type: row.trigger_event_key_public_key_type,
        public_key: row.trigger_event_key_public_key.clone(),
        sequence: row.trigger_event_key_sequence,
    }
}

/// The target event's comparable key, or `None` for notifications without a
/// target event (follows store an empty key).
fn target_key(row: &notification::Model) -> Option<TargetEventKey> {
    if row.target_event_key_identity.is_empty() {
        return None;
    }
    Some(TargetEventKey {
        collection: row.target_event_key_collection,
        identity: row.target_event_key_identity.clone(),
        public_key_type: row.target_event_key_public_key_type,
        public_key: row.target_event_key_public_key.clone(),
        sequence: row.target_event_key_sequence,
    })
}

/// Convert a comparable key into the proto `EventKey` used to fetch events.
fn to_proto_key(key: &TargetEventKey) -> EventKey {
    EventKey {
        collection: key.collection as i32,
        identity: key.identity.clone(),
        signed_by: Some(PublicKey {
            key_type: key.public_key_type as i32,
            key: key.public_key.clone(),
        }),
        sequence: key.sequence as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::context::ServiceContext;
    use crate::service::proto::content::ContentBody;
    use crate::service::proto::{Content, Labels};
    use ::entity::{content_model, event_model};
    use chrono::DateTime;
    use prost::Message;
    use sea_orm::{DbBackend, MockDatabase};

    fn notification_row(id: i64, from_identity: &str) -> notification::Model {
        let ts = chrono::DateTime::from_timestamp(0, 0).unwrap();
        notification::Model {
            id,
            kind: 1,
            from_identity: from_identity.to_string(),
            to_identity: "recipient".to_string(),
            trigger_event_key_collection: 2,
            trigger_event_key_identity: from_identity.to_string(),
            trigger_event_key_public_key_type: 1,
            trigger_event_key_public_key: vec![0xaa],
            trigger_event_key_sequence: id,
            target_event_key_collection: 0,
            target_event_key_identity: String::new(),
            target_event_key_public_key_type: 0,
            target_event_key_public_key: Vec::new(),
            target_event_key_sequence: 0,
            created_at: ts,
            updated_at: ts,
        }
    }

    fn params() -> Params {
        params_omitting(&[])
    }

    fn params_omitting(omit_labels: &[&str]) -> Params {
        Params {
            identity: "recipient".to_string(),
            limit: 50,
            after_id: None,
            omit_labels: omit_labels.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn label_event(
        row: &notification::Model,
        values: &[&str],
    ) -> EventWithContentRow {
        let ts = DateTime::from_timestamp(0, 0).unwrap().fixed_offset();
        let content = Content {
            content_body: Some(ContentBody::Labels(Labels {
                event_key: Some(to_proto_key(&trigger_key(row))),
                label_values: values.iter().map(|s| s.to_string()).collect(),
            })),
        };
        (
            event_model::Model {
                id: 900 + row.id,
                collection: 1,
                identity: "moderator".to_string(),
                public_key_type: 1,
                public_key: vec![0xbb],
                sequence: row.id,
                content_digest_type: Some(1),
                content_digest_bytes: Some(vec![row.id as u8]),
                signature: vec![row.id as u8],
                previous_signature: vec![],
                previous_root: vec![],
                application_id: None,
                event_bytes: vec![row.id as u8],
                created_at: ts,
                synced_at: ts,
            },
            Some(content_model::Model {
                id: 900 + row.id,
                digest_type: 1,
                digest_bytes: vec![row.id as u8],
                serialized_bytes: content.encode_to_vec(),
                synced_at: ts,
            }),
        )
    }

    fn hydrated() -> Hydrated {
        hydrated_blocking(&[])
    }

    fn hydrated_blocking(blocked: &[&str]) -> Hydrated {
        Hydrated {
            blocked_identities: Arc::new(
                blocked.iter().map(|s| s.to_string()).collect(),
            ),
            ..hydrated_with_labels(Vec::new())
        }
    }

    fn hydrated_with_labels(
        trigger_labels: Vec<EventWithContentRow>,
    ) -> Hydrated {
        Hydrated {
            bundles: HashMap::new(),
            event_hints: Vec::new(),
            trigger_labels,
            blocked_identities: Arc::default(),
        }
    }

    async fn service() -> Arc<ServiceContext> {
        let kafka_producer = common_kafka::build_producer()
            .await
            .expect("failed to build Kafka producer");
        ServiceContext::new(
            MockDatabase::new(DbBackend::Postgres).into_connection(),
            kafka_producer,
        )
    }

    #[tokio::test]
    async fn notifications_from_blocked_identities_are_dropped() {
        let service = service().await;
        let ctx = RequestContext::new(&service, Some("recipient"));
        let fetched = Fetched {
            rows: vec![
                notification_row(1, "bob"),
                notification_row(2, "alice"),
                notification_row(3, "bob"),
            ],
            has_next_page: false,
            has_previous_page: false,
        };

        let result =
            filter(&ctx, &params(), fetched, &hydrated_blocking(&["bob"]))
                .await
                .unwrap();

        let from: Vec<&str> = result
            .rows
            .iter()
            .map(|r| r.from_identity.as_str())
            .collect();
        assert_eq!(from, ["alice"]);
    }

    #[tokio::test]
    async fn a_page_of_only_blocked_notifications_comes_back_empty() {
        let service = service().await;
        let ctx = RequestContext::new(&service, Some("recipient"));
        let fetched = Fetched {
            rows: vec![notification_row(1, "bob")],
            has_next_page: true,
            has_previous_page: false,
        };

        let result =
            filter(&ctx, &params(), fetched, &hydrated_blocking(&["bob"]))
                .await
                .unwrap();

        assert!(result.rows.is_empty());
        assert!(result.has_next_page);
    }

    #[tokio::test]
    async fn an_anonymous_caller_sees_every_notification() {
        let service = service().await;
        let ctx = RequestContext::new(&service, None);
        let fetched = Fetched {
            rows: vec![notification_row(1, "bob")],
            has_next_page: false,
            has_previous_page: false,
        };

        let result =
            filter(&ctx, &params(), fetched, &hydrated()).await.unwrap();

        assert_eq!(result.rows.len(), 1);
    }

    #[tokio::test]
    async fn notifications_with_an_omitted_trigger_label_are_dropped() {
        let service = service().await;
        let ctx = RequestContext::new(&service, Some("recipient"));
        let labeled = notification_row(1, "bob");
        let clean = notification_row(2, "alice");
        let hydrated =
            hydrated_with_labels(vec![label_event(&labeled, &["spam"])]);
        let fetched = Fetched {
            rows: vec![labeled, clean],
            has_next_page: false,
            has_previous_page: false,
        };

        let result =
            filter(&ctx, &params_omitting(&["spam"]), fetched, &hydrated)
                .await
                .unwrap();

        let from: Vec<&str> = result
            .rows
            .iter()
            .map(|r| r.from_identity.as_str())
            .collect();
        assert_eq!(from, ["alice"]);
    }

    #[tokio::test]
    async fn a_label_outside_the_omit_set_keeps_the_notification() {
        let service = service().await;
        let ctx = RequestContext::new(&service, Some("recipient"));
        let labeled = notification_row(1, "bob");
        let hydrated =
            hydrated_with_labels(vec![label_event(&labeled, &["spam"])]);
        let fetched = Fetched {
            rows: vec![labeled],
            has_next_page: false,
            has_previous_page: false,
        };

        let result =
            filter(&ctx, &params_omitting(&["hate"]), fetched, &hydrated)
                .await
                .unwrap();

        assert_eq!(result.rows.len(), 1);
    }

    #[tokio::test]
    async fn labels_are_ignored_without_an_omit_set() {
        let service = service().await;
        let ctx = RequestContext::new(&service, Some("recipient"));
        let labeled = notification_row(1, "bob");
        let hydrated =
            hydrated_with_labels(vec![label_event(&labeled, &["spam"])]);
        let fetched = Fetched {
            rows: vec![labeled],
            has_next_page: false,
            has_previous_page: false,
        };

        let result = filter(&ctx, &params(), fetched, &hydrated).await.unwrap();

        assert_eq!(result.rows.len(), 1);
    }
}
