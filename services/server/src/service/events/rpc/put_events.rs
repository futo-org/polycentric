//! `put_events`: ingest signed events. Mutation — does not use the
//! events pipeline.

use crate::service::proto::content::ContentBody;
use crate::service::{
    content::content_repository as ContentRepository,
    context::ServiceContext,
    events::repository as EventsRepository,
    identity::repository::Query as IdentityRepository,
    identity::service::authorize_event_signer,
    proto::{
        Content, Delete, Event, EventBundle, PublicKey, PutEventError,
        PutEventsRequest, PutEventsResponse,
    },
};
use ::entity::event_model as EventModel;
use chrono::{DateTime, Utc};
use common_kafka::FutureRecord;
use polycentric_common::models::{collections, protos_v2::Blob};
use prost::Message;
use rdkafka::message::{Header, OwnedHeaders};
use sea_orm::{
    ActiveValue::{NotSet, Set},
    TransactionTrait,
};
use std::collections::HashMap;
use std::{collections::HashSet, time::Duration};
use tonic::Status;

/// Ingest a batch of signed events. Each event is processed in
/// isolation with failures reported back in `PutEventsResponse.errors`
pub async fn handle(
    ctx: &ServiceContext,
    req: PutEventsRequest,
) -> Result<PutEventsResponse, Status> {
    let mut errors: Vec<PutEventError> = Vec::new();
    let mut all_blobs = HashSet::<Blob>::new();

    let mut banned_cache = HashMap::new();
    for (idx, event_bundle) in req.event_bundles.into_iter().enumerate() {
        match process_event(ctx, event_bundle, &mut banned_cache).await {
            Ok(blobs) => {
                all_blobs.extend(blobs);
            }

            Err(status) => {
                tracing::debug!(
                    "put_events[{idx}] skipped: {} {}",
                    status.code(),
                    status.message()
                );
                errors.push(PutEventError {
                    event_bundle_index: idx as u32,
                    message: format!("{}: {}", status.code(), status.message()),
                });
            }
        }
    }

    let missing_blobs = remove_present_blobs(ctx, all_blobs)
        .await
        .unwrap_or_else(|e| {
            // A failure occurred while checking what blobs the server already has.
            // Assume the server is not in a condition to accept new blobs and silently
            // return no missing blobs to the client.
            tracing::warn!(error = %e, "put_events blob processing");
            vec![]
        });

    Ok(PutEventsResponse {
        errors,
        requested_blobs: missing_blobs,
    })
}

/// Validate and persist an event.
/// Returns all blobs referenced by the event.
async fn process_event(
    ctx: &ServiceContext,
    event_bundle: EventBundle,
    banned_cache: &mut HashMap<Box<str>, bool>,
) -> Result<Vec<Blob>, Status> {
    let mut blobs = Vec::<Blob>::new();

    // Encode the bundle up front while it's still whole — its fields are
    // moved out during validation below. Published to Kafka on success.
    let event_bundle_bytes = event_bundle.encode_to_vec();

    let signed_event = event_bundle.signed_event.ok_or_else(|| {
        Status::invalid_argument("package is missing signed event")
    })?;

    let event =
        Event::decode(signed_event.event_bytes.as_slice()).map_err(|e| {
            tracing::debug!(error = %e, "put_events decode error");
            Status::invalid_argument("invalid event_bytes")
        })?;

    let key = event
        .key
        .ok_or_else(|| Status::invalid_argument("event missing key"))?;

    // Early banned check based on the cache.
    let is_banned = banned_cache.get(&*key.identity).copied();
    match is_banned {
        Some(true) => return Err(banned_error()),
        Some(false) => { /* Ok to continue. */ }
        None => {
            let is_banned = IdentityRepository::is_banned(
                &ctx.ro_db,
                &key.identity,
            )
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "put_events ban check db error");
                Status::internal("internal server error")
            })?;
            banned_cache.insert(Box::from(&*key.identity), is_banned);
            if is_banned {
                return Err(banned_error());
            }
        }
    }

    // Kafka partition/message key: the serialized protobuf event key.
    // Encoded here while `key` is whole — its fields are moved out below.
    let event_key_bytes = key.encode_to_vec();

    let signed_by = key.signed_by.ok_or_else(|| {
        Status::invalid_argument("event key missing signed_by")
    })?;

    if !signed_by
        .sig_matches(&signed_event.signature, &signed_event.event_bytes)
    {
        return Err(Status::unauthenticated("invalid signature"));
    }

    // Decode the event before we begin the transaction.
    let decoded_content = if let (Some(serialized_content), Some(digest)) =
        (&event_bundle.serialized_content, &event.content_digest)
    {
        digest
            .verify_against(&serialized_content.content_bytes)
            .map_err(|err| Status::invalid_argument(err.to_string()))?;

        let bytes = serialized_content.content_bytes.as_slice();
        let content = Content::decode(bytes).map_err(|e| {
            tracing::debug!(error = %e, "put_events content decode error");
            Status::invalid_argument("invalid content_bytes")
        })?;

        content
            .blobs()
            .into_iter()
            .for_each(|blob| blobs.push(blob.clone()));

        Some((bytes, content, digest))
    } else {
        None
    };

    // Start a transaction to ensure all processing of a single event is handled
    // atomically.
    let txn = ctx.db.begin().await.map_err(|e| {
        tracing::error!(error = %e, "put_events txn begin error");
        Status::internal("internal server error")
    })?;

    // Authorize the signer against the target identity's chain.
    // Identity events are chain-validated at read time (see
    // `latest_valid_identity_content`); every other event must
    // be signed by a key the identity currently authorizes, or
    // by a key whose revocation bound still vouches for this
    // signature.
    if key.collection != collections::IDENTITY {
        authorize_event_signer(
            &txn,
            &ctx.proof_cache,
            &key.identity,
            &PublicKey {
                key_type: signed_by.key_type,
                key: signed_by.key.clone(),
            },
            key.collection,
            &signed_event.signature,
        )
        .await?;
    }

    let application_id = match &event.application {
        Some(app) => {
            Some(EventsRepository::Mutation::application_id(&txn, app).await.map_err(|e| {
                tracing::error!(error = %e, "put_events application db error");
                Status::internal("internal server error")
            })?)
        }
        None => None,
    };

    let event_identity = key.identity.clone();
    let event_collection = key.collection;

    let active_model = EventModel::ActiveModel {
        id: NotSet,
        collection: Set(key.collection as i16),
        identity: Set(key.identity),
        public_key_type: Set(signed_by.key_type as i16),
        public_key: Set(signed_by.key),
        sequence: Set(key.sequence as i64),
        content_digest_type: Set(event
            .content_digest
            .as_ref()
            .map(|d| d.r#type)),
        content_digest_bytes: Set(event
            .content_digest
            .as_ref()
            .map(|d| d.value.clone())),
        signature: Set(signed_event.signature),
        previous_signature: Set(event.previous_signature),
        previous_root: Set(event.previous_root),
        application_id: Set(application_id),
        event_bytes: Set(signed_event.event_bytes),
        created_at: Set(DateTime::from_timestamp_secs(
            (event.created_at / 1000) as i64,
        )
        .unwrap_or(Utc::now())
        .fixed_offset()),
        synced_at: Set(Utc::now().fixed_offset()),
    };

    match EventsRepository::Mutation::add_event(
        &txn,
        active_model,
        decoded_content,
    )
    .await
    {
        Ok(true) => {
            txn.commit().await.map_err(|err| {
                tracing::error!(error = %err, "put_events txn commit error");
                Status::internal("internal server error")
            })?;

            ctx.proof_cache
                .invalidate_canonical(&event_identity, event_collection)
                .await;
            if event_collection == collections::IDENTITY {
                ctx.proof_cache.invalidate_identity(&event_identity).await;
            }

            let producer = ctx.kafka_producer.clone();
            let topic = common_kafka::prefixed("events");
            tokio::spawn(async move {
                if let Err((e, _)) = producer
                    .send(
                        FutureRecord::to(&topic)
                            .key(&event_key_bytes)
                            .payload(&event_bundle_bytes)
                            .headers(OwnedHeaders::new().insert(Header {
                                key: "SOURCE_SERVER",
                                value: Some(
                                    crate::config::get().server_name.as_str(),
                                ),
                            })),
                        Duration::from_secs(0),
                    )
                    .await
                {
                    tracing::warn!(error = %e, "put_events kafka publish error");
                }
            });
        }
        Ok(false) => {
            // Duplicate event — already stored, treat as success, but revert
            // the content changes.
            txn.rollback().await.map_err(|err| {
                tracing::error!(error = %err, "put_events txn abort error");
                Status::internal("internal server error")
            })?;
        }
        Err(err) => {
            tracing::error!(error = %err, "put_events db error");
            return Err(Status::internal("internal server error"));
        }
    }

    Ok(blobs)
}

fn banned_error() -> Status {
    Status::permission_denied("identity is banned on this server")
}

/// Check if the `identity` is authorised to perform its mutation.
///
/// This will return false if, for example, an event tries to delete a post
/// that the identity of the deletion event didn't create.
///
/// `content` must be contained in the event itself.
pub fn event_is_authorised(identity: &str, content: Option<&Content>) -> bool {
    let Some(Content {
        content_body: Some(content),
    }) = content
    else {
        // Couldn't extract (valid) content, so don't consider the event as
        // authorised.
        return false;
    };

    match content {
        // Only events items related to the identity themselves.
        ContentBody::Post(_)
        | ContentBody::Follow(_)
        | ContentBody::Block(_)
        | ContentBody::Reaction(_)
        | ContentBody::AttributedToReaction(_)
        | ContentBody::ProfileUpdate(_)
        | ContentBody::Identity(_)
        | ContentBody::Repost(_)
        // Can report other identity's events.
        | ContentBody::Report(_)
        // Anyone can add any label.
        | ContentBody::Labels(_)
        // Anyone can make a claim.
        | ContentBody::VerificationClaim(_) => true,
        // Can only delete your own events.
        ContentBody::Delete(Delete { event_key }) => {
            let Some(event_key) = event_key else { return false; };
            // Make sure the identity of the deletion event is the same
            // as the identity of the to-be-deleted event.
            event_key.identity == identity
        },
        // TODO: these will need verification.
        ContentBody::VerificationVerify(_)
        | ContentBody::VerificationTarget(_) => false,
    }
}

/// Keep only the blobs that are not already present
async fn remove_present_blobs(
    ctx: &ServiceContext,
    blobs: HashSet<Blob>,
) -> Result<Vec<Blob>, Status> {
    let digests: Vec<_> = blobs
        .iter()
        .filter_map(|blob| blob.digest.as_ref())
        .collect();

    let already_present =
        ContentRepository::Query::find_digests_in_db(&ctx.ro_db, &digests)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "put_events blob db error");
                Status::internal("internal server error")
            })?;

    let missing_blobs = blobs
        .into_iter()
        .filter(|blob| match &blob.digest {
            Some(digest) => !already_present.contains(digest),
            None => false, // Ignore blobs missing a content digest
        })
        .collect();

    Ok(missing_blobs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::proto::{Block, EventKey};

    fn delete_content(target_identity: &str) -> Content {
        Content {
            content_body: Some(ContentBody::Delete(Delete {
                event_key: Some(EventKey {
                    collection: collections::SOCIAL_GRAPH,
                    identity: target_identity.to_string(),
                    signed_by: Some(PublicKey {
                        key_type: 1,
                        key: vec![0xaa],
                    }),
                    sequence: 1,
                }),
            })),
        }
    }

    #[test]
    fn a_delete_of_your_own_event_is_authorised() {
        assert!(event_is_authorised("alice", Some(&delete_content("alice")),));
    }

    #[test]
    fn a_delete_of_another_identitys_event_is_not_authorised() {
        assert!(!event_is_authorised(
            "mallory",
            Some(&delete_content("alice")),
        ));
    }

    #[test]
    fn a_delete_without_an_event_key_is_not_authorised() {
        let content = Content {
            content_body: Some(ContentBody::Delete(Delete { event_key: None })),
        };
        assert!(!event_is_authorised("alice", Some(&content)));
    }

    #[test]
    fn an_event_without_content_is_not_authorised() {
        assert!(!event_is_authorised("alice", None));
    }

    #[test]
    fn a_block_of_another_identity_is_authorised() {
        let content = Content {
            content_body: Some(ContentBody::Block(Block {
                identity: "bob".to_string(),
            })),
        };
        assert!(event_is_authorised("alice", Some(&content)));
    }
}
