use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signer, SigningKey};
use polycentric_common::jwt::ServerJwtClaims;
use polycentric_common::models::protos_v2::content::ContentBody;
use polycentric_common::models::protos_v2::event_sync_service_client::EventSyncServiceClient;
use polycentric_common::models::protos_v2::feeds_service_client::FeedsServiceClient;
use polycentric_common::models::protos_v2::graph_service_client::GraphServiceClient;
use polycentric_common::models::protos_v2::search_service_client::SearchServiceClient;
use polycentric_common::models::protos_v2::*;
use prost::Message;
use rand::distr::{Alphabetic, SampleString};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::mem::take;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;
use tokio::sync::OnceCell;

mod event_sync;
mod feeds;
mod graph;
mod search;

/// gRPC server address. Override with `POLYCENTRIC_TEST_SERVER` env var.
pub fn grpc_addr() -> String {
    std::env::var("POLYCENTRIC_TEST_SERVER")
        .unwrap_or_else(|_| "http://localhost:3000".to_string())
}

/// JWT auth token audience.
fn audience() -> String {
    match std::env::var("POLYCENTRIC_ALLOW_HOSTS") {
        Ok(hosts) => hosts
            .split(',')
            .map(str::trim)
            .filter(|host| !host.is_empty())
            .next()
            .expect("invalid POLYCENTRIC_ALLOW_HOSTS")
            .to_owned(),
        Err(_) => std::env::var("POLYCENTRIC_SERVER_NAME")
            .unwrap_or_else(|_| "http://localhost:3000".to_string()),
    }
}

/// 2025-01-15T12:00:00Z in milliseconds.
pub const DEFAULT_CREATED_AT: u64 = 1736942400000;
pub const HOUR: u64 = 3_600_000;

pub const COLLECTION_IDENTITY: i32 = 1;
pub const COLLECTION_FEED: i32 = 2;
pub const COLLECTION_PROFILE_UPDATE: i32 = 3;
pub const COLLECTION_INTERACTIONS: i32 = 4;
pub const COLLECTION_SOCIAL_GRAPH: i32 = 5;
pub const COLLECTION_REPORTS: i32 = 6;
pub const COLLECTION_LABELS: i32 = 7;
pub const COLLECTION_VERIFICATIONS: i32 = 8;
pub const COLLECTION_MAX: i32 = COLLECTION_VERIFICATIONS;

pub fn sha256(data: &[u8]) -> Vec<u8> {
    Sha256::digest(data).to_vec()
}

pub fn random_string() -> String {
    let mut s = SampleString::sample_string(&Alphabetic, &mut rand::rng(), 30);
    // When searching Postgres uses a technique called stemming where it removes
    // the end of certain English words, e.g. "party" and "party" both become
    // "part" so that when you search for "party" it matches both. However, when
    // using random values this sometimes causes the searching tests to fail
    // when not using this technique (e.g. for aliases and names).
    // So add some characters that should not be stemmed.
    s.push_str("BBB");
    s
}

pub fn repeated_string(n: usize, s: &str, separator: &str) -> String {
    let mut result = String::new();
    for _ in 0..n {
        result.push_str(s);
        result.push_str(separator);
    }
    if !result.is_empty() {
        result.truncate(result.len() - separator.len()); // Remove last separator.
    }
    result
}

pub async fn connect_event_sync()
-> EventSyncServiceClient<tonic::transport::Channel> {
    EventSyncServiceClient::connect(grpc_addr())
        .await
        .expect("failed to connect to gRPC server")
}

pub async fn connect_feeds() -> FeedsServiceClient<tonic::transport::Channel> {
    FeedsServiceClient::connect(grpc_addr())
        .await
        .expect("failed to connect to gRPC server")
}

pub async fn search_service() -> SearchServiceClient<tonic::transport::Channel>
{
    SearchServiceClient::connect(grpc_addr())
        .await
        .expect("failed to connect to gRPC server")
}

pub async fn graph_service() -> GraphServiceClient<tonic::transport::Channel> {
    GraphServiceClient::connect(grpc_addr())
        .await
        .expect("failed to connect to gRPC server")
}

pub fn generate_signing_key() -> SigningKey {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS random number generator failed");
    SigningKey::from_bytes(&bytes)
}

pub fn public_key_of(key: &SigningKey) -> PublicKey {
    PublicKey {
        key_type: KeyType::Ed25519.into(),
        key: key.verifying_key().as_bytes().to_vec(),
    }
}

fn content_with_digest(content: Content) -> (Vec<u8>, ContentDigest) {
    let bytes = prost::Message::encode_to_vec(&content);
    let digest = ContentDigest {
        r#type: ContentDigestType::Sha256.into(),
        value: sha256(&bytes),
    };
    (bytes, digest)
}

fn sign(signing_key: &SigningKey, event: Event) -> SignedEvent {
    let event_bytes = prost::Message::encode_to_vec(&event);
    let signature = signing_key.sign(&event_bytes).to_bytes().to_vec();
    SignedEvent {
        signature,
        event_bytes,
    }
}

#[derive(Debug)]
pub struct TestClient {
    key: SigningKey,
    identity: String,
    event_sync_client: EventSyncServiceClient<tonic::transport::Channel>,
    pending: Vec<EventBundle>,
    identity_sequence: Sequence,
    collection_sequences: [Sequence; COLLECTION_MAX as usize + 1], // 1-indexed.
}

#[derive(Debug)]
struct Sequence(u64);

impl Sequence {
    const fn new() -> Sequence {
        Sequence(1)
    }

    fn next(&mut self) -> u64 {
        let val = self.0;
        self.0 += 1;
        val
    }
}

impl TestClient {
    pub async fn new() -> TestClient {
        let key = generate_signing_key();
        TestClient::new_with_identity(key).await
    }

    /// Create a client for the trusted moderator.
    pub async fn trusted_moderator() -> TestClient {
        ensure_moderator_setup().await;
        let key = test_moderator_key();
        TestClient::new_with_identity(key).await
    }

    async fn new_with_identity(key: SigningKey) -> TestClient {
        let event_sync_client = connect_event_sync().await;
        let identity = Identity {
            rotation_keys: vec![public_key_of(&key)],
            signing_keys: vec![],
            revocation_bounds: vec![],
            servers: None,
            recovery_key: None,
            recovery_signature: None,
        };
        let mut client = TestClient {
            key,
            identity: identity.derive_hex_key(),
            event_sync_client,
            pending: Vec::new(),
            identity_sequence: Sequence::new(),
            collection_sequences: [const { Sequence::new() }; _],
        };
        client.set_identity(identity, DEFAULT_CREATED_AT);
        client
    }

    pub fn identity(&self) -> &str {
        &self.identity
    }

    pub fn event_sync_client(
        &mut self,
    ) -> &mut EventSyncServiceClient<tonic::transport::Channel> {
        &mut self.event_sync_client
    }

    // All these methods push an event bundle to the list of pending events to
    // sync. `submit_events` submits all the events to the server.

    pub fn set_identity(
        &mut self,
        identity: Identity,
        created_at: u64,
    ) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Identity(identity), created_at)
    }

    pub fn second_identity(&mut self, created_at: u64) -> Vec<u8> {
        self.set_identity(
            Identity {
                rotation_keys: vec![public_key_of(&self.key)],
                signing_keys: vec![],
                revocation_bounds: vec![],
                servers: Some(ServerList {
                    urls: vec![audience()],
                }),
                recovery_key: None,
                recovery_signature: None,
            },
            created_at,
        )
    }

    pub fn profile_update(
        &mut self,
        update: ProfileUpdate,
        created_at: u64,
    ) -> Vec<u8> {
        self.push_event_bundle(ContentBody::ProfileUpdate(update), created_at)
    }

    pub fn post(&mut self, post: Post, created_at: u64) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Post(post), created_at)
    }

    pub fn post_text(&mut self, text: &str, created_at: u64) -> Vec<u8> {
        let post = Post {
            text: text.to_owned(),
            reply: None,
            images: Vec::new(),
            quote: None,
            links: Vec::new(),
            labels: Vec::new(),
            attributed_to: Vec::new(),
        };
        self.post(post, created_at)
    }

    pub fn quote(
        &mut self,
        post: EventKey,
        text: &str,
        created_at: u64,
    ) -> Vec<u8> {
        let post = Post {
            text: text.to_owned(),
            reply: None,
            images: Vec::new(),
            quote: Some(post),
            links: Vec::new(),
            labels: Vec::new(),
            attributed_to: Vec::new(),
        };
        self.post(post, created_at)
    }

    pub fn reply(
        &mut self,
        post: EventKey,
        text: &str,
        created_at: u64,
    ) -> Vec<u8> {
        let post = Post {
            text: text.to_owned(),
            reply: Some(PostReply {
                root: None,
                parent: Some(post),
            }),
            images: Vec::new(),
            quote: None,
            links: Vec::new(),
            labels: Vec::new(),
            attributed_to: Vec::new(),
        };
        self.post(post, created_at)
    }

    pub fn label(&mut self, labels: Labels, created_at: u64) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Labels(labels), created_at)
    }

    pub fn follow(&mut self, follow: Follow, created_at: u64) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Follow(follow), created_at)
    }

    pub fn follow_identity(
        &mut self,
        identity: String,
        created_at: u64,
    ) -> Vec<u8> {
        self.follow(Follow { identity }, created_at)
    }

    pub fn react(&mut self, reaction: Reaction, created_at: u64) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Reaction(reaction), created_at)
    }

    pub fn thumbs_up(&mut self, on: EventKey, created_at: u64) -> Vec<u8> {
        self.react(
            Reaction {
                event_key: Some(on),
                emoji: Some("👍".to_owned()),
                positive: true,
            },
            created_at,
        )
    }

    pub fn thumbs_down(&mut self, on: EventKey, created_at: u64) -> Vec<u8> {
        self.react(
            Reaction {
                event_key: Some(on),
                emoji: Some("👎".to_owned()),
                positive: false,
            },
            created_at,
        )
    }

    pub fn repost(&mut self, repost: Repost, created_at: u64) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Repost(repost), created_at)
    }

    pub fn repost_key(
        &mut self,
        event_key: EventKey,
        created_at: u64,
    ) -> Vec<u8> {
        let repost = Repost {
            post: Some(event_key),
        };
        self.repost(repost, created_at)
    }

    pub fn delete(&mut self, delete: Delete, created_at: u64) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Delete(delete), created_at)
    }

    pub fn delete_key(
        &mut self,
        event_key: EventKey,
        created_at: u64,
    ) -> Vec<u8> {
        let delete = Delete {
            event_key: Some(event_key),
        };
        self.delete(delete, created_at)
    }

    pub fn get_last_event_key(&self) -> EventKey {
        let event = self.pending.last().expect("no pending events");
        let signed_event = event.signed_event.as_ref().unwrap();
        let event = Event::decode(&*signed_event.event_bytes).unwrap();
        event.key.unwrap()
    }

    fn push_event_bundle(
        &mut self,
        body: ContentBody,
        created_at: u64,
    ) -> Vec<u8> {
        let collection = match &body {
            ContentBody::Post(_) | ContentBody::Delete(_) => COLLECTION_FEED,
            ContentBody::Follow(_) | ContentBody::Block(_) => {
                COLLECTION_SOCIAL_GRAPH
            }
            ContentBody::Reaction(_) | ContentBody::AttributedToReaction(_) => {
                COLLECTION_INTERACTIONS
            }
            ContentBody::ProfileUpdate(_) => COLLECTION_PROFILE_UPDATE,
            ContentBody::Identity(_) => COLLECTION_IDENTITY,
            ContentBody::Repost(_) => COLLECTION_FEED,
            ContentBody::Report(_) => COLLECTION_REPORTS,
            ContentBody::Labels(_) => COLLECTION_LABELS,
            ContentBody::VerificationClaim(_)
            | ContentBody::VerificationVerify(_)
            | ContentBody::VerificationTarget(_) => COLLECTION_VERIFICATIONS,
        };
        let content = Content {
            content_body: Some(body),
        };
        let (content_bytes, digest) = content_with_digest(content);
        let event = self.make_event(
            collection,
            Vec::new(),
            Vec::new(),
            digest,
            created_at,
        );
        let event_bundle = bundle(sign(&self.key, event), content_bytes);
        let signature = bundle_signature(&event_bundle);
        self.pending.push(event_bundle);
        signature
    }

    fn make_event(
        &mut self,
        collection: i32,
        previous_signature: Vec<u8>,
        previous_root: Vec<u8>,
        digest: ContentDigest,
        created_at: u64,
    ) -> Event {
        make_event(
            collection,
            &self.identity,
            &self.key,
            self.collection_sequences[collection as usize].next(),
            self.identity_sequence.next(),
            // TODO: this seems always acceptable?
            VectorClock { sequence: vec![1] },
            previous_signature,
            previous_root,
            digest,
            created_at,
        )
    }

    /// Submit all pending events.
    pub async fn submit_events(&mut self) {
        let event_bundles = take(&mut self.pending);
        if event_bundles.is_empty() {
            return;
        }

        let response = self
            .event_sync_client
            .put_events(PutEventsRequest {
                event_bundles: event_bundles.clone(),
            })
            .await
            .expect("put_events failed")
            .into_inner();

        if !response.errors.is_empty() {
            let n = response.errors.len();
            for (n, err) in response.errors.iter().enumerate() {
                eprintln!("Error {}:", n + 1);
                eprintln!(
                    "Error in {:?}",
                    event_bundles[err.event_bundle_index as usize]
                );
                eprintln!("Error: {}", err.message);
            }
            panic!("{n} unexpected error(s)");
        }
    }

    pub fn create_auth_token(&self) -> String {
        let header = serde_json::json!({
            "alg": "EdDSA",
            "typ": "JWT",
            "kid": hex::encode(self.key.verifying_key().as_bytes()),
        });

        let now = SystemTime::UNIX_EPOCH.elapsed().unwrap().as_secs();
        let payload = ServerJwtClaims {
            iss: self.identity().to_owned(),
            aud: audience(),
            iat: now,
            exp: now + (24 * 60 * 60),
        };

        let to_sign = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).unwrap()),
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap()),
        );
        let signature = self.key.sign(to_sign.as_bytes());

        format!(
            "Bearer {to_sign}.{}",
            URL_SAFE_NO_PAD.encode(signature.to_bytes().as_slice()),
        )
    }
}

impl Drop for TestClient {
    fn drop(&mut self) {
        const MSG: &str = "Unsubmitted events in TestClient, call submit_events to submit them";
        if !self.pending.is_empty() {
            if !std::thread::panicking() {
                panic!("{}", MSG);
            } else {
                eprintln!("{}", MSG);
            }
        }
    }
}

pub fn current_timestamp() -> u64 {
    SystemTime::UNIX_EPOCH.elapsed().unwrap().as_millis() as u64
}

#[allow(clippy::too_many_arguments)]
fn make_event(
    collection: i32,
    identity: &str,
    signing_key: &SigningKey,
    sequence: u64,
    identity_sequence: u64,
    vector_clock: VectorClock,
    previous_signature: Vec<u8>,
    previous_root: Vec<u8>,
    digest: ContentDigest,
    created_at: u64,
) -> Event {
    Event {
        key: Some(EventKey {
            collection,
            identity: identity.to_string(),
            signed_by: Some(public_key_of(signing_key)),
            sequence,
        }),
        identity_sequence,
        vector_clock: Some(vector_clock),
        previous_signature,
        previous_root,
        content_digest: Some(digest),
        created_at,
        application: None,
    }
}

fn bundle(signed_event: SignedEvent, content_bytes: Vec<u8>) -> EventBundle {
    EventBundle {
        signed_event: Some(signed_event),
        serialized_content: Some(SerializedContent { content_bytes }),
        event_proofs: vec![],
        meta: None,
    }
}

/// Build a signed identity-collection bundle.
#[allow(clippy::too_many_arguments)]
pub fn make_identity_bundle(
    identity: &str,
    signing_key: &SigningKey,
    sequence: u64,
    identity_sequence: u64,
    vector_clock: Vec<u64>,
    identity_content: Identity,
    created_at: u64,
) -> EventBundle {
    let content = Content {
        content_body: Some(content::ContentBody::Identity(identity_content)),
    };
    let (content_bytes, digest) = content_with_digest(content);
    let event = make_event(
        COLLECTION_IDENTITY,
        identity,
        signing_key,
        sequence,
        identity_sequence,
        VectorClock {
            sequence: vector_clock,
        },
        vec![],
        vec![],
        digest,
        created_at,
    );
    bundle(sign(signing_key, event), content_bytes)
}

#[allow(clippy::too_many_arguments)]
pub fn make_profile_update_bundle(
    identity: &str,
    signing_key: &SigningKey,
    sequence: u64,
    identity_sequence: u64,
    vector_clock: Vec<u64>,
    update: ProfileUpdate,
    created_at: u64,
) -> EventBundle {
    let content = Content {
        content_body: Some(content::ContentBody::ProfileUpdate(update)),
    };
    let (content_bytes, digest) = content_with_digest(content);
    let event = make_event(
        COLLECTION_PROFILE_UPDATE,
        identity,
        signing_key,
        sequence,
        identity_sequence,
        VectorClock {
            sequence: vector_clock,
        },
        vec![],
        vec![],
        digest,
        created_at,
    );
    bundle(sign(signing_key, event), content_bytes)
}

/// Build a signed feed-collection post bundle with `previous_root` set to
/// the MMR root over the signer's prior FEED events.
#[allow(clippy::too_many_arguments)]
pub fn make_post_bundle(
    identity: &str,
    signing_key: &SigningKey,
    sequence: u64,
    identity_sequence: u64,
    vector_clock: Vec<u64>,
    previous_root: Vec<u8>,
    text: &str,
    attributed_urls: &[&str],
    created_at: u64,
) -> EventBundle {
    let attributed_to = attributed_urls
        .iter()
        .map(|url| AttributedTo {
            to: Some(attributed_to::To::Link(Link {
                url: url.to_string(),
                ..Default::default()
            })),
        })
        .collect();
    let content = Content {
        content_body: Some(content::ContentBody::Post(Post {
            text: text.to_string(),
            reply: None,
            images: vec![],
            quote: None,
            links: vec![],
            labels: vec![],
            attributed_to,
        })),
    };
    let (content_bytes, digest) = content_with_digest(content);
    let event = make_event(
        COLLECTION_FEED,
        identity,
        signing_key,
        sequence,
        identity_sequence,
        VectorClock {
            sequence: vector_clock,
        },
        vec![],
        previous_root,
        digest,
        created_at,
    );
    bundle(sign(signing_key, event), content_bytes)
}

/// Build a signed verification-claim bundle carrying a one-field schema
/// (`handle`) and a value for it.
pub fn make_verification_claim_bundle(
    identity: &str,
    signing_key: &SigningKey,
    sequence: u64,
    identity_sequence: u64,
    vector_clock: Vec<u64>,
    handle: &str,
    created_at: u64,
) -> EventBundle {
    let schema = VerificationSchema {
        name: "X Verification".to_string(),
        description: String::new(),
        fields: vec![FieldDef {
            key: "handle".to_string(),
            kind: FieldKind::String as i32,
            format: String::new(),
            required: true,
            description: "Handle".to_string(),
            regex: None,
            max_len: None,
        }],
    };
    let schema_bytes = prost::Message::encode_to_vec(&schema);
    let schema_digest = ContentDigest {
        r#type: ContentDigestType::Sha256.into(),
        value: sha256(&schema_bytes),
    };

    let mut fields = HashMap::new();
    fields.insert("handle".to_string(), handle.as_bytes().to_vec());

    let content = Content {
        content_body: Some(content::ContentBody::VerificationClaim(
            VerificationClaim {
                schema: Some(SerializedVerificationSchema {
                    schema_bytes,
                    digest: Some(schema_digest),
                }),
                fields,
            },
        )),
    };
    let (content_bytes, digest) = content_with_digest(content);
    let event = make_event(
        COLLECTION_VERIFICATIONS,
        identity,
        signing_key,
        sequence,
        identity_sequence,
        VectorClock {
            sequence: vector_clock,
        },
        vec![],
        vec![],
        digest,
        created_at,
    );
    bundle(sign(signing_key, event), content_bytes)
}

/// RFC 6962 leaf hash: `SHA256(0x00 || data)`. Mirrors `polycentric_common::merkle`.
pub fn leaf_hash(data: &[u8]) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update([0x00u8]);
    h.update(data);
    h.finalize().to_vec()
}

/// RFC 6962 internal node hash: `SHA256(0x01 || left || right)`.
pub fn node_hash(left: &[u8], right: &[u8]) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update([0x01u8]);
    h.update(left);
    h.update(right);
    h.finalize().to_vec()
}

/// Build a revocation bound for a single revoked signer with one collection.
pub fn make_revocation_bound(
    revoked_key: &SigningKey,
    collection: i32,
    head_signature: Vec<u8>,
    head_root: Vec<u8>,
    leaf_count: u64,
) -> RevocationBound {
    RevocationBound {
        revoked_key: Some(public_key_of(revoked_key)),
        targets: vec![EventProofTarget {
            collection,
            signature: head_signature,
            root: head_root,
            leaf_count,
        }],
    }
}

/// Read the signature out of a freshly-built bundle (panics on a malformed bundle).
pub fn bundle_signature(b: &EventBundle) -> Vec<u8> {
    b.signed_event
        .as_ref()
        .expect("bundle missing signed_event")
        .signature
        .clone()
}

/// Deterministic signing key for the test moderator. The server must be
/// started with `POLYCENTRIC_MODERATION_IDENTITY` set to
/// [`test_moderator_identity()`] for these tests to pass.
pub fn test_moderator_key() -> SigningKey {
    let seed = sha256(b"polycentric-test-moderator-seed-2026");
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&seed[..32]);
    SigningKey::from_bytes(&bytes)
}

/// Identity string of the test moderator — the value that must be set as
/// `POLYCENTRIC_MODERATION_IDENTITY` when starting the server.
pub fn test_moderator_identity() -> String {
    let key = test_moderator_key();
    let initial = Identity {
        rotation_keys: vec![public_key_of(&key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    initial.derive_hex_key()
}

/// Build a signed Labels-collection (collection 7) event bundle targeting
/// `target_event_key` with the given label values.
#[allow(clippy::too_many_arguments)]
pub fn make_labels_bundle(
    identity: &str,
    signing_key: &SigningKey,
    sequence: u64,
    identity_sequence: u64,
    vector_clock: Vec<u64>,
    previous_root: Vec<u8>,
    target_event_key: EventKey,
    label_values: Vec<String>,
    created_at: u64,
) -> EventBundle {
    let content = Content {
        content_body: Some(content::ContentBody::Labels(Labels {
            event_key: Some(target_event_key),
            label_values,
        })),
    };
    let (content_bytes, digest) = content_with_digest(content);
    let event = make_event(
        COLLECTION_LABELS,
        identity,
        signing_key,
        sequence,
        identity_sequence,
        VectorClock {
            sequence: vector_clock,
        },
        vec![],
        previous_root,
        digest,
        created_at,
    );
    bundle(sign(signing_key, event), content_bytes)
}

// Following are moderation / label integration tests: The server must
// be started with `POLYCENTRIC_MODERATION_IDENTITY` set to the value
// returned by `test_moderator_identity()`.

/// Ensures the moderator's genesis identity event is published exactly once
/// across all tests (the moderator identity is deterministic, so sequence
/// collisions would silently fail on the second insert).
static MODERATOR_READY: OnceCell<()> = OnceCell::const_new();

async fn ensure_moderator_setup() {
    MODERATOR_READY
        .get_or_init(|| async {
            let mut event = connect_event_sync().await;
            let mod_key = test_moderator_key();
            let mod_identity = test_moderator_identity();
            publish_genesis(
                &mut event,
                &mod_identity,
                &mod_key,
                DEFAULT_CREATED_AT,
            )
            .await;
        })
        .await;
}

/// Monotonic sequence number for the moderator's Labels events — each test
/// needs a unique (collection, identity, pub_key, sequence) tuple or the
/// duplicate is silently dropped by the server. Seeded from the clock because
/// test runners like nextest run each test in its own process, so a fixed
/// initial value would collide across concurrently running tests.
static NEXT_LABELS_SEQ: OnceLock<AtomicU64> = OnceLock::new();

async fn next_labels_seq() -> u64 {
    NEXT_LABELS_SEQ
        .get_or_init(|| {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock before unix epoch")
                .as_nanos() as u64;
            AtomicU64::new(nanos)
        })
        .fetch_add(1, Ordering::Relaxed)
}

async fn publish_genesis(
    client: &mut EventSyncServiceClient<tonic::transport::Channel>,
    identity: &str,
    key: &SigningKey,
    created_at: u64,
) -> Vec<u8> {
    let initial = Identity {
        rotation_keys: vec![public_key_of(key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let bundle =
        make_identity_bundle(identity, key, 1, 1, vec![1], initial, created_at);
    let sig = bundle_signature(&bundle);
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![bundle],
        })
        .await
        .expect("genesis put failed");
    sig
}

async fn publish_post(
    client: &mut EventSyncServiceClient<tonic::transport::Channel>,
    identity: &str,
    key: &SigningKey,
    text: &str,
    attributed_urls: &[&str],
    created_at: u64,
) -> Vec<u8> {
    let bundle = make_post_bundle(
        identity,
        key,
        1,
        1,
        vec![1],
        vec![],
        text,
        attributed_urls,
        created_at,
    );
    let sig = bundle_signature(&bundle);
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![bundle],
        })
        .await
        .expect("post put failed");
    sig
}

async fn publish_labels(
    client: &mut EventSyncServiceClient<tonic::transport::Channel>,
    identity: &str,
    key: &SigningKey,
    target_event_key: EventKey,
    label_values: Vec<String>,
    created_at: u64,
) -> Vec<u8> {
    let seq = next_labels_seq().await;
    let bundle = make_labels_bundle(
        identity,
        key,
        seq,
        1,
        vec![1],
        vec![],
        target_event_key,
        label_values,
        created_at,
    );
    let sig = bundle_signature(&bundle);
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![bundle],
        })
        .await
        .expect("labels put failed");
    sig
}

fn get_post_event_key(identity: &str, key: &SigningKey) -> EventKey {
    EventKey {
        collection: COLLECTION_FEED,
        identity: identity.to_string(),
        signed_by: Some(public_key_of(key)),
        sequence: 1,
    }
}

/// Returns the labels bundle content if it decodes to Labels, panics otherwise.
fn assert_is_labels_bundle(
    bundle: &EventBundle,
    expected_target: &EventKey,
    expected_values: &[&str],
) {
    let sc = bundle
        .serialized_content
        .as_ref()
        .expect("bundle has serialized_content");
    let content = Content::decode(sc.content_bytes.as_slice())
        .expect("valid content protobuf");
    match &content.content_body {
        Some(content::ContentBody::Labels(labels)) => {
            let ek = labels.event_key.as_ref().expect("Labels has event_key");
            assert_eq!(ek.collection, expected_target.collection);
            assert_eq!(ek.identity, expected_target.identity);
            assert_eq!(ek.sequence, expected_target.sequence);
            let actual: Vec<&str> =
                labels.label_values.iter().map(|s| s.as_str()).collect();
            assert_eq!(actual, expected_values, "label_values mismatch");
        }
        _ => panic!(
            "expected Labels content body, got {:?}",
            content.content_body
        ),
    }
}
