//! Stats worker.
//!
//! Consumes the `events` topic and updates aggregate "statistics" like reply
//! and reaction counters.

use std::sync::Arc;

use common_kafka::{BorrowedMessage, Message};
use polycentric_common::models::protos_v2::{
    AttributedToReaction, Content, Event, EventBundle, EventKey,
    attributed_to::To, content::ContentBody,
};
use prost::Message as _;
use sea_orm::DbConn;

use crate::data::EventWithContentRow;
use crate::service::context::ServiceContext;
use crate::service::events::TargetEventKey;
use crate::service::feeds::repository::Query as FeedsRepository;
use crate::service::stats::repository::Mutation;
use crate::workers::{MessageHandler, Outcome, WorkerError, run_consumer};

pub struct StatsWorker {
    ctx: Arc<ServiceContext>,
}

impl StatsWorker {
    pub const NAME: &'static str = "server-stats-worker";

    pub fn new(ctx: Arc<ServiceContext>) -> Self {
        Self { ctx }
    }

    pub async fn run(self) -> Result<(), WorkerError> {
        tracing::info!(worker = Self::NAME, topic = "events", "consuming");
        run_consumer(Self::NAME, &["events"], self).await
    }

    /// Process a single kafka message's payload.
    /// Returns `Ok(())` as long as we should commit past the message.
    async fn process(&self, payload: &[u8]) -> Result<(), WorkerError> {
        let Some(input) = Input::extract_from(payload) else {
            return Ok(());
        };

        match input.content_body {
            ContentBody::Delete(delete) => {
                let Some(target) = delete.event_key else {
                    return Ok(());
                };

                // Skip events where the target and author identity don't match
                if target.identity != input.key.identity {
                    return Ok(());
                }

                // Try retrieving the content of the deleted event
                let Some(content_body) =
                    find_content_by_key(&self.ctx.ro_db, target).await?
                else {
                    return Ok(());
                };

                // Remove the deleted URL reaction from the URL counters
                if let ContentBody::AttributedToReaction(reaction) =
                    content_body
                    && let Some(url) = attributed_reaction_url(&reaction)
                {
                    Mutation::remove_attributed_reaction_for(
                        &self.ctx.db,
                        url,
                        reaction.positive,
                    )
                    .await?;
                }
            }

            // Count an out-of-network (URL) reaction — e.g. a video like.
            ContentBody::AttributedToReaction(reaction) => {
                if let Some(url) = attributed_reaction_url(&reaction) {
                    Mutation::count_attributed_reaction_for(
                        &self.ctx.db,
                        url,
                        reaction.positive,
                    )
                    .await?;
                }
            }
            _ => {}
        }

        Ok(())
    }
}

/// Extract the attributed URL (`Link.url`) from an out-of-network reaction.
fn attributed_reaction_url(reaction: &AttributedToReaction) -> Option<String> {
    match reaction.attributed_to.as_ref().and_then(|a| a.to.as_ref()) {
        Some(To::Link(link)) => Some(link.url.clone()),
        _ => None,
    }
}

#[tonic::async_trait]
impl MessageHandler for StatsWorker {
    async fn handle(&self, message: &BorrowedMessage<'_>) -> Outcome {
        let Some(payload) = message.payload() else {
            return Outcome::Commit;
        };

        match self.process(payload).await {
            Ok(()) => Outcome::Commit,
            Err(e) => {
                tracing::warn!(worker = Self::NAME, error = %e, "failed to process event");
                Outcome::Retry
            }
        }
    }
}

/// Try to convert the protobuf event key to a `TargetEventKey`.
fn to_target_key(key: EventKey) -> Option<TargetEventKey> {
    let signer = key.signed_by?;
    Some(TargetEventKey {
        collection: key.collection as i16,
        identity: key.identity,
        public_key_type: signer.key_type as i16,
        public_key: signer.key,
        sequence: key.sequence as i64,
    })
}

/// Values extracted from the kafka message that we will use.
struct Input {
    key: TargetEventKey,
    content_body: ContentBody,
}

impl Input {
    /// Extract all of the protobuf fields that we need.
    /// Ignore events that do not have a valid value for any of them.
    fn extract_from(payload: &[u8]) -> Option<Self> {
        let bundle = EventBundle::decode(payload).ok()?;
        let signed = bundle.signed_event?;
        let event = Event::decode(signed.event_bytes.as_slice()).ok()?;
        let key = to_target_key(event.key?)?;
        let content_bytes = bundle.serialized_content?.content_bytes;
        let content = Content::decode(content_bytes.as_slice()).ok()?;
        let content_body = content.content_body?;

        Some(Input { key, content_body })
    }
}

async fn find_event_by_key(
    db: &DbConn,
    key: EventKey,
) -> Result<Option<EventWithContentRow>, WorkerError> {
    let Some(signer) = key.signed_by else {
        return Ok(None);
    };

    let event = FeedsRepository::find_event_by_key(
        db,
        key.collection as i16,
        &key.identity,
        signer.key_type as i16,
        signer.key,
        key.sequence as i64,
    )
    .await?;

    Ok(event)
}

/// Try to find the content for the event with key `key`.
/// Returns `Ok(None)` on failures other than DB errors.
async fn find_content_by_key(
    db: &DbConn,
    key: EventKey,
) -> Result<Option<ContentBody>, WorkerError> {
    let Some((_, Some(content_row))) = find_event_by_key(db, key).await? else {
        return Ok(None);
    };

    let Ok(Content {
        content_body: Some(content_body),
    }) = Content::decode(content_row.serialized_bytes.as_slice())
    else {
        return Ok(None);
    };

    Ok(Some(content_body))
}
