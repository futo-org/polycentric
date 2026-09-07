//! Notification worker.
//!
//! Consumes the `events` topic and turns relevant events (replies, follows,
//! reposts, reactions) into rows in the `notification` table.

use std::sync::Arc;
use std::time::Duration;

use ::entity::notification;
use chrono::Utc;
use common_kafka::{BorrowedMessage, FutureRecord, Message};
use polycentric_common::models::protos_v2::{
    Content, Event, EventBundle, EventKey, Notification, NotificationKind,
    content::ContentBody,
};
use prost::Message as _;
use rdkafka::message::{Header, OwnedHeaders};
use sea_orm::{ActiveModelTrait, NotSet, Set};

use crate::data::row_into_bundle;
use crate::service::context::ServiceContext;
use crate::service::events::TargetEventKey;
use crate::service::feeds::repository::Query as FeedsRepository;
use crate::service::graph::repository::Query as GraphRepository;
use crate::service::proofs::service::attach_proofs;
use crate::service::verifications::repository::Query as VerificationsRepository;
use crate::workers::{MessageHandler, Outcome, WorkerError, run_consumer};

/// Kafka topic the materialized `Notification` messages are produced to.
const NOTIFICATIONS_TOPIC: &str = "notifications";

pub struct NotificationWorker {
    ctx: Arc<ServiceContext>,
}

impl NotificationWorker {
    /// Stable identifier; also the Kafka consumer group id (the unit of
    /// horizontal scaling).
    pub const NAME: &'static str = "server-notification-worker";

    pub fn new(ctx: Arc<ServiceContext>) -> Self {
        Self { ctx }
    }

    pub async fn run(self) -> Result<(), WorkerError> {
        tracing::info!(worker = Self::NAME, topic = "events", "consuming");
        run_consumer(Self::NAME, &["events"], self).await
    }

    /// Load the target event by its key and assemble it into an
    /// `EventBundle` (with revocation proofs attached), mirroring how feeds
    /// build bundles. Returns `Ok(None)` when the target isn't stored on this
    /// server (a legitimate miss — e.g. a reply to a post we never received);
    /// a DB/proof error propagates so the message is retried.
    async fn hydrate_target(
        &self,
        key: &EventKey,
    ) -> Result<Option<EventBundle>, WorkerError> {
        let Some(signed_by) = key.signed_by.as_ref() else {
            return Ok(None);
        };

        let Some(row) = FeedsRepository::find_event_by_key(
            &self.ctx.ro_db,
            key.collection as i16,
            &key.identity,
            signed_by.key_type as i16,
            signed_by.key.clone(),
            key.sequence as i64,
        )
        .await?
        else {
            return Ok(None);
        };

        let mut bundles = vec![row_into_bundle(row)];
        attach_proofs(&self.ctx, &mut bundles).await?;
        Ok(bundles.into_iter().next())
    }

    /// Whether `verifier` was asked — via a VerificationTarget published by
    /// the claim's own owner — to verify the claim at `claim_key`.
    async fn verification_was_requested(
        &self,
        claim_key: &Option<EventKey>,
        verifier: &str,
    ) -> Result<bool, WorkerError> {
        let Some(claim_key) = claim_key else {
            return Ok(false);
        };
        let (public_key_type, public_key) = claim_key
            .signed_by
            .as_ref()
            .map(|pk| (pk.key_type as i16, pk.key.clone()))
            .unwrap_or_default();
        let key = TargetEventKey {
            collection: claim_key.collection as i16,
            identity: claim_key.identity.clone(),
            public_key_type,
            public_key,
            sequence: claim_key.sequence as i64,
        };
        Ok(VerificationsRepository::was_verification_requested(
            &self.ctx.ro_db,
            &key,
            verifier,
        )
        .await?)
    }

    /// The recipients of `notifications` that do not block `author`. A
    /// recipient that blocks the actor gets neither a stored notification
    /// nor a push.
    async fn unblocked_recipients<'a>(
        &self,
        notifications: &'a [PendingNotification],
        author: &str,
    ) -> Result<Vec<&'a String>, WorkerError> {
        // TODO: the query called in `identites_blocking` could be more
        // efficient. See the method's doc comment.
        let blockers = GraphRepository::identities_blocking(
            &self.ctx,
            notifications.iter().map(|n| n.to_identity.as_str()),
            author,
        )
        .await?;

        Ok(notifications
            .iter()
            .map(|notification| &notification.to_identity)
            .filter(|to_identity| !blockers.contains(*to_identity))
            .collect())
    }

    // Emit a Notification event to Kafka, that can be consumed by the
    // push-notifications service. The message key carries the recipient.
    async fn emit(
        &self,
        to_identity: &str,
        kind: NotificationKind,
        trigger: EventBundle,
        target_event: Option<EventBundle>,
    ) -> Result<(), WorkerError> {
        let payload = Notification {
            trigger_event: Some(trigger),
            target_event,
            kind: kind as i32,
        }
        .encode_to_vec();

        let topic = common_kafka::prefixed(NOTIFICATIONS_TOPIC);
        let record = FutureRecord::to(&topic)
            .key(to_identity.as_bytes())
            .payload(&payload)
            .headers(OwnedHeaders::new().insert(Header {
                key: "SOURCE_SERVER",
                value: Some(crate::config::get().server_name.as_str()),
            }));

        self.ctx
            .kafka_producer
            .send(record, Duration::from_secs(0))
            .await
            .map(|_| ())
            .map_err(|(e, _)| e.into())
    }
}

#[tonic::async_trait]
impl MessageHandler for NotificationWorker {
    async fn handle(&self, message: &BorrowedMessage<'_>) -> Outcome {
        let Some(payload) = message.payload() else {
            return Outcome::Commit;
        };

        let bundle = match EventBundle::decode(payload) {
            Ok(bundle) => bundle,
            Err(e) => {
                // Undecodable payloads will never succeed — commit past.
                tracing::warn!(worker = Self::NAME, error = %e, "failed to decode EventBundle");
                return Outcome::Commit;
            }
        };

        // The triggering event (its key) and its content. Anything that
        // doesn't decode produces no notification — nothing to retry.
        let Some(signed) = bundle.signed_event.as_ref() else {
            return Outcome::Commit;
        };
        let Ok(event) = Event::decode(signed.event_bytes.as_slice()) else {
            return Outcome::Commit;
        };
        let Some(trigger_key) = event.key.as_ref() else {
            return Outcome::Commit;
        };
        let Some(serialized) = bundle.serialized_content.as_ref() else {
            return Outcome::Commit;
        };
        let Ok(content) = Content::decode(serialized.content_bytes.as_slice())
        else {
            return Outcome::Commit;
        };

        // Not every event produces notifications (and self-actions never
        // do).
        let notifications =
            build_notifications(&trigger_key.identity, &content);
        let Some(PendingNotification { kind, target, .. }) =
            notifications.first()
        else {
            return Outcome::Commit;
        };
        let kind = *kind;

        // A completed verification only notifies when the claim's owner
        // actually requested it from this verifier — unsolicited verify
        // events produce nothing.
        if kind == NotificationKind::VerificationComplete {
            match self
                .verification_was_requested(target, &trigger_key.identity)
                .await
            {
                Ok(true) => {}
                Ok(false) => return Outcome::Commit,
                Err(e) => {
                    tracing::warn!(
                        worker = Self::NAME,
                        error = %e,
                        "failed to check for a verification request"
                    );
                    return Outcome::Retry;
                }
            }
        }

        let recipients = match self
            .unblocked_recipients(&notifications, &trigger_key.identity)
            .await
        {
            Ok(recipients) => recipients,
            Err(e) => {
                tracing::warn!(
                    worker = Self::NAME,
                    error = %e,
                    "failed to check recipient blocks"
                );
                return Outcome::Retry;
            }
        };
        if recipients.is_empty() {
            return Outcome::Commit;
        }

        tracing::info!(
            worker = Self::NAME,
            kind = ?kind,
            from = trigger_key.identity,
            recipients = ?recipients,
            "processing notification"
        );

        let trigger = KeyColumns::from(trigger_key);
        // Follows have no target event; store an empty key for them.
        let target_cols =
            target.as_ref().map(KeyColumns::from).unwrap_or_default();
        let now = Utc::now();

        for to_identity in &recipients {
            // NOTE: a redelivered message (rebalance / crash before commit)
            // will insert a duplicate row until a unique dedup index exists
            // to make this an upsert.
            let row = notification::ActiveModel {
                id: NotSet,
                kind: Set(kind as i32),
                from_identity: Set(trigger.identity.clone()),
                to_identity: Set((*to_identity).clone()),
                trigger_event_key_collection: Set(trigger.collection),
                trigger_event_key_identity: Set(trigger.identity.clone()),
                trigger_event_key_public_key_type: Set(trigger.public_key_type),
                trigger_event_key_public_key: Set(trigger.public_key.clone()),
                trigger_event_key_sequence: Set(trigger.sequence),
                target_event_key_collection: Set(target_cols.collection),
                target_event_key_identity: Set(target_cols.identity.clone()),
                target_event_key_public_key_type: Set(
                    target_cols.public_key_type
                ),
                target_event_key_public_key: Set(target_cols
                    .public_key
                    .clone()),
                target_event_key_sequence: Set(target_cols.sequence),
                created_at: Set(now),
                updated_at: Set(now),
            };

            if let Err(e) = row.insert(&self.ctx.db).await {
                tracing::warn!(
                    worker = Self::NAME,
                    error = %e,
                    "failed to insert notification"
                );
                return Outcome::Retry;
            }
        }

        // Hydrate the target event (the post replied to / reposted / reacted
        // to, or the claim to verify) so the produced `Notification` carries
        // it. Follows have none.
        let target_event = match target.as_ref() {
            Some(key) => match self.hydrate_target(key).await {
                Ok(bundle) => bundle,
                Err(e) => {
                    tracing::warn!(
                        worker = Self::NAME,
                        error = %e,
                        "failed to hydrate target event"
                    );
                    return Outcome::Retry;
                }
            },
            None => None,
        };

        // One message per recipient — the push service reads the recipient
        // from the message key.
        for to_identity in &recipients {
            if let Err(e) = self
                .emit(to_identity, kind, bundle.clone(), target_event.clone())
                .await
            {
                tracing::warn!(
                    worker = Self::NAME,
                    error = %e,
                    "failed to produce notification"
                );
                return Outcome::Retry;
            }
        }

        tracing::info!(
            worker = Self::NAME,
            kind = ?kind,
            recipients = ?recipients,
            "created notification"
        );
        Outcome::Commit
    }
}

/// A notification waiting to be recorded and delivered: its kind, the
/// recipient, and the event it refers to (absent for follows).
struct PendingNotification {
    kind: NotificationKind,
    to_identity: String,
    target: Option<EventKey>,
}

/// The notifications a single event produces, if any. `author` is the
/// identity of the triggering event; self-actions (replying to your own
/// post, following yourself, …) produce nothing. Every notification an
/// event produces shares its kind and target — only the recipient varies.
fn build_notifications(
    author: &str,
    content: &Content,
) -> Vec<PendingNotification> {
    let mut notifications = Vec::new();
    let mut notify = |kind, to_identity: &str, target: Option<EventKey>| {
        if to_identity != author {
            notifications.push(PendingNotification {
                kind,
                to_identity: to_identity.to_string(),
                target,
            });
        }
    };

    match content.content_body.as_ref() {
        // A post is a reply (notify the parent's author) or a quote (notify
        // the quoted post's author). Reply takes precedence when both are set.
        Some(ContentBody::Post(post)) => {
            if let Some(parent) =
                post.reply.as_ref().and_then(|reply| reply.parent.as_ref())
            {
                notify(
                    NotificationKind::Reply,
                    &parent.identity,
                    Some(parent.clone()),
                );
            } else if let Some(quote) = post.quote.as_ref() {
                notify(
                    NotificationKind::Quote,
                    &quote.identity,
                    Some(quote.clone()),
                );
            }
        }
        // Repost -> notify the author of the reposted post.
        Some(ContentBody::Repost(repost)) => {
            if let Some(post) = repost.post.as_ref() {
                notify(
                    NotificationKind::Repost,
                    &post.identity,
                    Some(post.clone()),
                );
            }
        }
        // Reaction -> notify the author of the reacted-to event.
        Some(ContentBody::Reaction(reaction)) => {
            if let Some(target) = reaction.event_key.as_ref() {
                notify(
                    NotificationKind::Reaction,
                    &target.identity,
                    Some(target.clone()),
                );
            }
        }
        // Follow -> notify the followed identity (no target event).
        Some(ContentBody::Follow(follow)) => {
            notify(NotificationKind::Follow, &follow.identity, None);
        }
        // Verification target -> notify every identity requested to verify
        // the claim, with the claim event as the target.
        Some(ContentBody::VerificationTarget(target)) => {
            for identity in &target.target_identities {
                notify(
                    NotificationKind::VerificationRequest,
                    identity,
                    target.claim_event_key.clone(),
                );
            }
        }
        // Verification verify -> notify the claim's owner their claim was
        // verified, with the claim event as the target. Whether the
        // verification was actually requested is checked against the DB in
        // `handle` — unsolicited verifies produce nothing.
        Some(ContentBody::VerificationVerify(verify)) => {
            if let Some(claim) = verify.claim_event_key.as_ref() {
                notify(
                    NotificationKind::VerificationComplete,
                    &claim.identity,
                    Some(claim.clone()),
                );
            }
        }
        _ => {}
    }

    notifications
}

/// An `EventKey` flattened into the columns the `notification` table stores.
/// `Default` yields the empty key used for notifications without a target
/// event (follows).
#[derive(Default)]
struct KeyColumns {
    collection: i16,
    identity: String,
    public_key_type: i16,
    public_key: Vec<u8>,
    sequence: i64,
}

impl From<&EventKey> for KeyColumns {
    fn from(key: &EventKey) -> Self {
        let (public_key_type, public_key) = key
            .signed_by
            .as_ref()
            .map(|pk| (pk.key_type as i16, pk.key.clone()))
            .unwrap_or_default();
        KeyColumns {
            collection: key.collection as i16,
            identity: key.identity.clone(),
            public_key_type,
            public_key,
            sequence: key.sequence as i64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use polycentric_common::models::protos_v2::{
        Block, Follow, Post, PostReply, PublicKey, Reaction, Repost,
        VerificationTarget, VerificationVerify,
    };
    use sea_orm::{DatabaseConnection, DbBackend, DbErr, MockDatabase, Value};
    use std::collections::BTreeMap;

    /// A fully-populated `EventKey` for `identity`.
    fn event_key(identity: &str) -> EventKey {
        EventKey {
            collection: 2,
            identity: identity.to_string(),
            signed_by: Some(PublicKey {
                key_type: 1,
                key: vec![0xAB, 0xCD],
            }),
            sequence: 7,
        }
    }

    fn content(body: ContentBody) -> Content {
        Content {
            content_body: Some(body),
        }
    }

    /// The lone notification, when the event produced exactly one.
    fn single(
        mut notifications: Vec<PendingNotification>,
    ) -> Option<PendingNotification> {
        (notifications.len() == 1).then(|| notifications.remove(0))
    }

    #[test]
    fn reply_to_another_user_notifies_the_parent_author() {
        let parent = event_key("bob");
        let c = content(ContentBody::Post(Post {
            reply: Some(PostReply {
                root: None,
                parent: Some(parent.clone()),
            }),
            ..Default::default()
        }));

        let notification = single(build_notifications("alice", &c))
            .expect("reply should notify");
        assert_eq!(notification.kind, NotificationKind::Reply);
        assert_eq!(notification.to_identity, "bob");
        assert_eq!(notification.target, Some(parent));
    }

    #[test]
    fn self_reply_does_not_notify() {
        let c = content(ContentBody::Post(Post {
            reply: Some(PostReply {
                root: None,
                parent: Some(event_key("alice")),
            }),
            ..Default::default()
        }));
        assert!(build_notifications("alice", &c).is_empty());
    }

    #[test]
    fn post_without_a_reply_does_not_notify() {
        let c = content(ContentBody::Post(Post::default()));
        assert!(build_notifications("alice", &c).is_empty());
    }

    #[test]
    fn quote_notifies_the_quoted_author() {
        let quoted = event_key("bob");
        let c = content(ContentBody::Post(Post {
            quote: Some(quoted.clone()),
            ..Default::default()
        }));

        let notification = single(build_notifications("alice", &c))
            .expect("quote should notify");
        assert_eq!(notification.kind, NotificationKind::Quote);
        assert_eq!(notification.to_identity, "bob");
        assert_eq!(notification.target, Some(quoted));
    }

    #[test]
    fn repost_notifies_the_reposted_author() {
        let target = event_key("bob");
        let c = content(ContentBody::Repost(Repost {
            post: Some(target.clone()),
        }));

        let notification = single(build_notifications("alice", &c))
            .expect("repost should notify");
        assert_eq!(notification.kind, NotificationKind::Repost);
        assert_eq!(notification.to_identity, "bob");
        assert_eq!(notification.target, Some(target));
    }

    #[test]
    fn reaction_notifies_the_reacted_author() {
        let target = event_key("bob");
        let c = content(ContentBody::Reaction(Reaction {
            event_key: Some(target.clone()),
            emoji: None,
            positive: true,
        }));

        let notification = single(build_notifications("alice", &c))
            .expect("reaction should notify");
        assert_eq!(notification.kind, NotificationKind::Reaction);
        assert_eq!(notification.to_identity, "bob");
        assert_eq!(notification.target, Some(target));
    }

    #[test]
    fn follow_notifies_the_followed_user_without_a_target() {
        let c = content(ContentBody::Follow(Follow {
            identity: "bob".to_string(),
        }));

        let notification = single(build_notifications("alice", &c))
            .expect("follow should notify");
        assert_eq!(notification.kind, NotificationKind::Follow);
        assert_eq!(notification.to_identity, "bob");
        assert_eq!(notification.target, None);
    }

    #[test]
    fn self_follow_does_not_notify() {
        let c = content(ContentBody::Follow(Follow {
            identity: "alice".to_string(),
        }));
        assert!(build_notifications("alice", &c).is_empty());
    }

    #[test]
    fn non_notification_content_does_not_notify() {
        let c = content(ContentBody::Block(Block {
            identity: "bob".to_string(),
        }));
        assert!(build_notifications("alice", &c).is_empty());
    }

    #[test]
    fn empty_content_does_not_notify() {
        assert!(
            build_notifications("alice", &Content { content_body: None })
                .is_empty()
        );
    }

    #[test]
    fn verification_target_notifies_every_target_identity() {
        let claim = event_key("alice");
        let c = content(ContentBody::VerificationTarget(VerificationTarget {
            claim_event_key: Some(claim.clone()),
            target_identities: vec!["bob".to_string(), "carol".to_string()],
        }));

        let notifications = build_notifications("alice", &c);
        assert_eq!(notifications.len(), 2);
        for (d, expected) in notifications.iter().zip(["bob", "carol"]) {
            assert_eq!(d.kind, NotificationKind::VerificationRequest);
            assert_eq!(d.to_identity, expected);
            assert_eq!(d.target, Some(claim.clone()));
        }
    }

    #[test]
    fn verification_target_excludes_the_author() {
        let c = content(ContentBody::VerificationTarget(VerificationTarget {
            claim_event_key: Some(event_key("alice")),
            target_identities: vec!["alice".to_string(), "bob".to_string()],
        }));

        let notifications = build_notifications("alice", &c);
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].to_identity, "bob");
    }

    #[test]
    fn verification_verify_notifies_the_claim_owner() {
        let claim = event_key("bob");
        let c = content(ContentBody::VerificationVerify(VerificationVerify {
            claim_event_key: Some(claim.clone()),
        }));

        let notification = single(build_notifications("alice", &c))
            .expect("a verify of another identity's claim should notify");
        assert_eq!(notification.kind, NotificationKind::VerificationComplete);
        assert_eq!(notification.to_identity, "bob");
        assert_eq!(notification.target, Some(claim));
    }

    #[test]
    fn verifying_your_own_claim_does_not_notify() {
        let c = content(ContentBody::VerificationVerify(VerificationVerify {
            claim_event_key: Some(event_key("alice")),
        }));
        assert!(build_notifications("alice", &c).is_empty());
    }

    #[test]
    fn verification_verify_without_claim_key_does_not_notify() {
        let c = content(ContentBody::VerificationVerify(VerificationVerify {
            claim_event_key: None,
        }));
        assert!(build_notifications("alice", &c).is_empty());
    }

    #[test]
    fn verification_target_without_targets_does_not_notify() {
        let c = content(ContentBody::VerificationTarget(VerificationTarget {
            claim_event_key: Some(event_key("alice")),
            target_identities: vec![],
        }));
        assert!(build_notifications("alice", &c).is_empty());
    }

    async fn worker(db: DatabaseConnection) -> NotificationWorker {
        let kafka_producer = common_kafka::build_producer()
            .await
            .expect("failed to build Kafka producer");
        NotificationWorker::new(ServiceContext::new(db, kafka_producer))
    }

    fn pending(to_identity: &str) -> PendingNotification {
        PendingNotification {
            kind: NotificationKind::Reply,
            to_identity: to_identity.to_string(),
            target: Some(event_key("alice")),
        }
    }

    fn blocker_row(blocker: &str) -> BTreeMap<String, Value> {
        BTreeMap::from([("blocker".to_string(), Value::from(blocker))])
    }

    #[tokio::test]
    async fn recipients_blocking_the_author_are_dropped() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![blocker_row("bob")]])
            .into_connection();
        let worker = worker(db).await;
        let notifications = vec![pending("bob"), pending("carol")];

        let recipients = worker
            .unblocked_recipients(&notifications, "alice")
            .await
            .expect("block lookup should succeed");
        assert_eq!(recipients, [&"carol".to_string()]);
    }

    #[tokio::test]
    async fn recipients_are_kept_when_none_block_the_author() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([Vec::<BTreeMap<String, Value>>::new()])
            .into_connection();
        let worker = worker(db).await;
        let notifications = vec![pending("bob"), pending("carol")];

        let recipients = worker
            .unblocked_recipients(&notifications, "alice")
            .await
            .expect("block lookup should succeed");
        assert_eq!(recipients, [&"bob".to_string(), &"carol".to_string()]);
    }

    #[tokio::test]
    async fn a_failed_block_lookup_is_an_error() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_errors([DbErr::Custom("db is down".to_string())])
            .into_connection();
        let worker = worker(db).await;

        assert!(
            worker
                .unblocked_recipients(&[pending("bob")], "alice")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn an_empty_batch_skips_the_block_lookup() {
        // No `append_query_results`, so the mock errors if a query runs.
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let worker = worker(db).await;

        let recipients = worker
            .unblocked_recipients(&[], "alice")
            .await
            .expect("no lookup should be attempted");
        assert!(recipients.is_empty());
    }

    #[test]
    fn key_columns_flattens_an_event_key() {
        let cols = KeyColumns::from(&event_key("bob"));
        assert_eq!(cols.collection, 2);
        assert_eq!(cols.identity, "bob");
        assert_eq!(cols.public_key_type, 1);
        assert_eq!(cols.public_key, vec![0xAB, 0xCD]);
        assert_eq!(cols.sequence, 7);
    }

    #[test]
    fn key_columns_defaults_signer_fields_when_unsigned() {
        let mut key = event_key("bob");
        key.signed_by = None;
        let cols = KeyColumns::from(&key);
        assert_eq!(cols.identity, "bob");
        assert_eq!(cols.public_key_type, 0);
        assert!(cols.public_key.is_empty());
    }
}
