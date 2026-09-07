use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use ed25519_dalek::{Signer, SigningKey};
use polycentric_common::models::collections;
use polycentric_common::models::protos_v2::{
    Content, ContentDigest, ContentDigestType, Event, EventBundle, EventKey, KeyType, Labels,
    ListEventsFilters, ListEventsRequest, PublicKey, PutEventsRequest, Report, ReportCategory,
    SerializedContent, SignedEvent, content::ContentBody,
    event_sync_service_client::EventSyncServiceClient,
};
use tracing::{info, warn};
// rs-core's client manages the local event/content stores and chain math.
use polycentric_core::client::PolycentricClient as CoreClient;
use polycentric_core::query::channel;
use polycentric_core::sync as core_sync;
use prost::Message;
use sha2::{Digest, Sha256};

/// Failure while publishing a labels event.
pub enum PublishError {
    /// The service's identity state is not available (e.g. the identity
    /// chain was never loaded). The caller should retry rather than drop
    /// the label.
    NotReady(String),
    /// A transient failure (network/server). Retrying may succeed.
    Transient(String),
}

impl std::fmt::Display for PublishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PublishError::NotReady(m) => write!(f, "not ready: {m}"),
            PublishError::Transient(m) => write!(f, "transient: {m}"),
        }
    }
}

/// Chain position for the next event we author in a collection, read from
/// the durable Postgres store (not local in-memory state) so that multiple
/// moderation processes extend a single, shared chain consistently.
pub struct ChainHead {
    /// Sequence to assign the next event (`max(sequence) + 1`, or 1).
    pub next_sequence: u64,
    /// Canonically-latest signature in the collection (empty if none).
    pub previous_signature: Vec<u8>,
    /// Merkle root over the collection's canonical signatures (empty if none).
    pub previous_root: Vec<u8>,
}

/// Signed event and content that should persist to the database.
pub struct CreatedEvent {
    /// The decoded event (carries key, digest, previous_root, etc.).
    pub event: Event,
    /// Signature over `event_bytes`.
    pub signature: Vec<u8>,
    /// Canonical serialized `Event` (the bytes that were signed).
    pub event_bytes: Vec<u8>,
    /// Serialized `Content` message.
    pub content_bytes: Vec<u8>,
}

pub struct PolycentricClient {
    signing_key: SigningKey,
    public_key: PublicKey,
    /// Hex identity string this service publishes under.
    identity: String,
    /// gRPC server URLs to bootstrap from and publish to.
    servers: Vec<String>,
    /// Sequence of our identity chain's head, learned at sync. Used as
    /// the `identity_sequence` of events we author (it references the
    /// identity document that authorizes our signing key).
    identity_sequence: AtomicU64,
    /// In-memory mirror of our identity + labels events, used to compute
    /// sequence/vector-clock/root for the next event.
    core: Mutex<CoreClient>,
}

impl PolycentricClient {
    /// Build from the signing key seed, identity, and server URLs in
    /// [`crate::config::Config`]. Fails if the seed is not valid hex.
    pub fn new(config: &crate::config::Config) -> Result<Self, String> {
        let seed = decode_hex_32(&config.signing_key)?;
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = PublicKey {
            key_type: KeyType::Ed25519 as i32,
            key: signing_key.verifying_key().to_bytes().to_vec(),
        };

        Ok(Self {
            signing_key,
            public_key,
            identity: config.identity.clone(),
            servers: config.servers.clone(),
            identity_sequence: AtomicU64::new(0),
            core: Mutex::new(CoreClient::new()),
        })
    }

    /// Reconcile with every server, the way the JS clients do on startup:
    /// seed the local client with everything we have authored (`created`,
    /// read back from Postgres), pull each server's state, then push
    /// whatever that server's heads say it is missing.
    pub async fn sync(&self, created: Vec<EventBundle>) {
        let count = created.len();
        self.core.lock().unwrap().copy_bundles(created);
        info!("sync: loaded {count} previously authored bundles");

        for server in &self.servers {
            match self.fetch_identity_state(server).await {
                Ok(count) => info!("sync: pulled {count} bundles from {server}"),
                Err(e) => warn!("sync: failed to pull identity state from {server}: {e}"),
            }
        }
        if self.identity_sequence.load(Ordering::Relaxed) == 0 {
            warn!(
                "sync: no identity events found for {} on any server; \
                 label publishing will be skipped until the identity is available",
                self.identity
            );
        }

        for server in &self.servers {
            match self.push_missing(server).await {
                Ok(0) => info!("sync: {server} is up to date"),
                Ok(count) => info!("sync: pushed {count} missing events to {server}"),
                Err(e) => warn!("sync: failed to push missing events to {server}: {e}"),
            }
        }
    }

    /// Push the events `server` is missing, based on the chain heads it
    /// reports. Returns how many bundles were sent.
    async fn push_missing(&self, server: &str) -> Result<usize, String> {
        let heads = core_sync::request_heads(&self.identity, server)
            .await
            .map_err(|e| e.to_string())?;

        let bundles = {
            let core = self.core.lock().unwrap();
            core_sync::bundle_unsent_events(&core, &self.identity, heads)
                .map_err(|e| e.to_string())?
        };

        if bundles.is_empty() {
            return Ok(0);
        }

        let count = bundles.len();
        let response = core_sync::push_bundles(server, bundles)
            .await
            .map_err(|e| e.to_string())?;
        if !response.errors.is_empty() {
            let messages: Vec<&str> = response.errors.iter().map(|e| e.message.as_str()).collect();
            return Err(format!("server rejected events: {messages:?}"));
        }

        Ok(count)
    }

    async fn fetch_identity_state(&self, server: &str) -> Result<usize, String> {
        let chan = channel(server).await?;
        let mut client = EventSyncServiceClient::new(chan);

        let mut bundles = Vec::new();
        for collection in [collections::IDENTITY, collections::LABELS] {
            let response = client
                .list_events(ListEventsRequest {
                    filters: Some(ListEventsFilters {
                        collection: Some(collection),
                        identity: Some(self.identity.clone()),
                        ..Default::default()
                    }),
                    size: None,
                })
                .await
                .map_err(|e| format!("list_events(collection={collection}): {e}"))?;
            bundles.extend(response.into_inner().event_bundles);
        }

        // Learn the identity head sequence (max sequence among identity
        // events) so we can reference it as `identity_sequence`.
        let head = max_identity_sequence(&bundles);
        if head > 0 {
            self.identity_sequence.fetch_max(head, Ordering::Relaxed);
        }

        let count = bundles.len();
        self.core.lock().unwrap().copy_bundles(bundles);
        Ok(count)
    }

    /// The hex identity string this service publishes under.
    pub fn identity(&self) -> &str {
        &self.identity
    }

    /// The public key this service signs events with.
    pub fn public_key(&self) -> &PublicKey {
        &self.public_key
    }

    /// Build, sign, and push a `Labels` event for `target`.
    pub async fn publish_labels(
        &self,
        target: EventKey,
        label_values: Vec<String>,
        head: ChainHead,
    ) -> Result<CreatedEvent, PublishError> {
        let (content_bytes, digest) = labels_content(&target, &label_values);
        self.publish_content(collections::LABELS, content_bytes, digest, head)
            .await
    }

    /// Build, sign, and push a `Report` event for `target`.
    pub async fn publish_report(
        &self,
        target: EventKey,
        category: ReportCategory,
        additional_info: String,
        head: ChainHead,
    ) -> Result<CreatedEvent, PublishError> {
        let (content_bytes, digest) = report_content(&target, category, &additional_info);
        self.publish_content(collections::REPORTS, content_bytes, digest, head)
            .await
    }

    /// Build, sign, and push an event carrying already-serialized `content`
    /// (with its `digest`) on `collection`, extending the chain at `head`.
    /// Shared by the labels and reports publishers.
    async fn publish_content(
        &self,
        collection: i32,
        content_bytes: Vec<u8>,
        digest: ContentDigest,
        head: ChainHead,
    ) -> Result<CreatedEvent, PublishError> {
        let identity_sequence = self.identity_sequence.load(Ordering::Relaxed);
        if identity_sequence == 0 {
            return Err(PublishError::NotReady(
                "identity state not loaded".to_string(),
            ));
        }

        // The sequence and prior-chain references come from the durable
        // Postgres store (`head`); only the vector clock is derived locally,
        // from the static identity chain loaded at bootstrap.
        let sequence = head.next_sequence;
        let vector_clock = {
            let core = self.core.lock().unwrap();
            core.build_vector_clock(
                &self.identity,
                collection,
                identity_sequence,
                &self.public_key,
                sequence,
                None,
            )
            .map_err(|e| PublishError::NotReady(e.to_string()))?
        };

        let event = Event {
            key: Some(EventKey {
                collection,
                identity: self.identity.clone(),
                signed_by: Some(self.public_key.clone()),
                sequence,
            }),
            identity_sequence,
            vector_clock: Some(vector_clock),
            previous_signature: head.previous_signature,
            previous_root: head.previous_root,
            content_digest: Some(digest),
            created_at: now_millis(),
            application: None,
        };

        let event_bytes = event.encode_to_vec();
        let signature = self.signing_key.sign(&event_bytes).to_bytes().to_vec();
        let signed_event = SignedEvent {
            signature: signature.clone(),
            event_bytes: event_bytes.clone(),
        };
        let bundle = EventBundle {
            signed_event: Some(signed_event),
            serialized_content: Some(SerializedContent {
                content_bytes: content_bytes.clone(),
            }),
            event_proofs: vec![],
            meta: None,
        };

        // Push to every server; success on any is enough to consider it
        // published (servers gossip among themselves).
        let request = PutEventsRequest {
            event_bundles: vec![bundle],
        };
        let mut pushed = false;
        for server in &self.servers {
            match put_events(server, request.clone()).await {
                Ok(()) => pushed = true,
                Err(e) => warn!("publish: put_events to {server} failed: {e}"),
            }
        }
        if !pushed {
            return Err(PublishError::Transient(
                "failed to push event to any server".to_string(),
            ));
        }

        // No local state to update: the next event's chain position is read
        // back from Postgres once the caller persists this one.
        Ok(CreatedEvent {
            event,
            signature,
            event_bytes,
            content_bytes,
        })
    }
}

/// Highest sequence among the identity-collection events in `bundles`.
fn max_identity_sequence(bundles: &[EventBundle]) -> u64 {
    bundles
        .iter()
        .filter_map(|b| b.signed_event.as_ref())
        .filter_map(|se| Event::decode(se.event_bytes.as_slice()).ok())
        .filter_map(|e| e.key)
        .filter(|k| k.collection == collections::IDENTITY)
        .map(|k| k.sequence)
        .max()
        .unwrap_or(0)
}

/// Push a request to a single server, treating any per-event error the
/// server reports for our event as a failure.
async fn put_events(server: &str, request: PutEventsRequest) -> Result<(), String> {
    let chan = channel(server).await?;
    let mut client = EventSyncServiceClient::new(chan);
    let response = client
        .put_events(request)
        .await
        .map_err(|e| format!("put_events: {e}"))?;
    let errors = response.into_inner().errors;
    if !errors.is_empty() {
        let messages: Vec<&str> = errors.iter().map(|e| e.message.as_str()).collect();
        return Err(format!("server rejected event: {messages:?}"));
    }
    Ok(())
}

/// Build the serialized `Labels` content for `target`/`label_values` and
/// its digest.
pub fn labels_content(target: &EventKey, label_values: &[String]) -> (Vec<u8>, ContentDigest) {
    let content = Content {
        content_body: Some(ContentBody::Labels(Labels {
            event_key: Some(target.clone()),
            label_values: label_values.to_vec(),
        })),
    };
    let content_bytes = content.encode_to_vec();
    let digest = ContentDigest {
        r#type: ContentDigestType::Sha256 as i32,
        value: sha256(&content_bytes),
    };
    (content_bytes, digest)
}

/// Build the serialized `Report` content for `target`/`category` and its
/// digest.
pub fn report_content(
    target: &EventKey,
    category: ReportCategory,
    additional_info: &str,
) -> (Vec<u8>, ContentDigest) {
    let content = Content {
        content_body: Some(ContentBody::Report(Report {
            event_key: Some(target.clone()),
            category: category as i32,
            additional_info: additional_info.to_string(),
        })),
    };
    let content_bytes = content.encode_to_vec();
    let digest = ContentDigest {
        r#type: ContentDigestType::Sha256 as i32,
        value: sha256(&content_bytes),
    };
    (content_bytes, digest)
}

fn sha256(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// Current wall-clock time in milliseconds since the Unix epoch.
fn now_millis() -> u64 {
    let now = time::OffsetDateTime::now_utc();
    (now.unix_timestamp_nanos() / 1_000_000) as u64
}

/// Decode a 64-character hex string into 32 bytes.
fn decode_hex_32(s: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(s).map_err(|e| format!("invalid signing key hex: {e}"))?;
    let out = bytes
        .try_into()
        .map_err(|_| "signing key must decode to 32 bytes")?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_hex_32_roundtrip() {
        let bytes = [0xABu8; 32];
        let as_hex: String = hex::encode(bytes);
        assert_eq!(decode_hex_32(&as_hex).unwrap(), bytes);
    }

    #[test]
    fn decode_hex_32_rejects_wrong_length() {
        assert!(decode_hex_32("abcd").is_err());
    }

    #[test]
    fn decode_hex_32_rejects_non_hex() {
        assert!(decode_hex_32(&"z".repeat(64)).is_err());
    }
}
