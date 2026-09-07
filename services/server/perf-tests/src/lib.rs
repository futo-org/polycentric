use std::mem::take;
use std::time::SystemTime;

use ed25519_dalek::{Signer, SigningKey};
use rand::distr::{Alphabetic, SampleString};
use sha2::{Digest, Sha256};

use polycentric_common::models::collections;
use polycentric_common::models::protos_v2::content::ContentBody;
use polycentric_common::models::protos_v2::event_sync_service_client::EventSyncServiceClient;
use polycentric_common::models::protos_v2::{
    Block, Content, ContentDigest, ContentDigestType, Delete, Event,
    EventBundle, EventKey, Follow, Identity, KeyType, Labels, Post, PostReply,
    ProfileUpdate, PublicKey, PutEventsRequest, Reaction, Report,
    ReportCategory, Repost, SerializedContent, SignedEvent, VectorClock,
};
use prost::Message;

const COLLECTION_MAX: i32 = collections::VERIFICATIONS;

#[derive(Debug)]
pub struct Client {
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

impl Client {
    pub async fn new(address: String) -> Client {
        let key = SigningKey::from_bytes(&rand::random());
        let event_sync_client = EventSyncServiceClient::connect(address)
            .await
            .expect("failed to connect");
        let identity = Identity {
            rotation_keys: vec![public_key_of(&key)],
            signing_keys: vec![],
            revocation_bounds: vec![],
            servers: None,
            recovery_key: None,
            recovery_signature: None,
        };
        let mut client = Client {
            key,
            identity: identity.derive_hex_key(),
            event_sync_client,
            pending: Vec::new(),
            identity_sequence: Sequence::new(),
            collection_sequences: [const { Sequence::new() }; _],
        };
        client.set_identity(identity, current_timestamp());
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

    pub fn add_labels(
        &mut self,
        on: EventKey,
        labels: Vec<String>,
        created_at: u64,
    ) -> Vec<u8> {
        self.label(
            Labels {
                event_key: Some(on),
                label_values: labels,
            },
            created_at,
        )
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

    pub fn block(&mut self, block: Block, created_at: u64) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Block(block), created_at)
    }

    pub fn block_identity(
        &mut self,
        identity: String,
        created_at: u64,
    ) -> Vec<u8> {
        self.block(Block { identity }, created_at)
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

    pub fn report(&mut self, report: Report, created_at: u64) -> Vec<u8> {
        self.push_event_bundle(ContentBody::Report(report), created_at)
    }

    pub fn report_key(
        &mut self,
        event_key: EventKey,
        category: ReportCategory,
        created_at: u64,
    ) -> Vec<u8> {
        self.report(
            Report {
                event_key: Some(event_key),
                category: category as _,
                additional_info: String::new(),
            },
            created_at,
        )
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
            ContentBody::Post(_) | ContentBody::Delete(_) => collections::FEED,
            ContentBody::Follow(_) | ContentBody::Block(_) => {
                collections::SOCIAL_GRAPH
            }
            ContentBody::Reaction(_) | ContentBody::AttributedToReaction(_) => {
                collections::INTERACTIONS
            }
            ContentBody::ProfileUpdate(_) => collections::PROFILE,
            ContentBody::Identity(_) => collections::IDENTITY,
            ContentBody::Repost(_) => collections::FEED,
            ContentBody::Report(_) => collections::REPORTS,
            ContentBody::Labels(_) => collections::LABELS,
            ContentBody::VerificationClaim(_)
            | ContentBody::VerificationVerify(_)
            | ContentBody::VerificationTarget(_) => collections::VERIFICATIONS,
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
        Event {
            key: Some(EventKey {
                collection,
                identity: self.identity.clone(),
                signed_by: Some(public_key_of(&self.key)),
                sequence: self.collection_sequences[collection as usize].next(),
            }),
            identity_sequence: self.identity_sequence.next(),
            vector_clock: Some(VectorClock { sequence: vec![1] }),
            previous_signature,
            previous_root,
            content_digest: Some(digest),
            created_at,
            application: None,
        }
    }

    pub fn pending(&self) -> &[EventBundle] {
        &self.pending
    }

    /// Submit all pending events.
    pub async fn submit_events(&mut self) {
        let event_bundles = take(&mut self.pending);
        if event_bundles.is_empty() {
            return;
        }

        self.event_sync_client
            .put_events(PutEventsRequest { event_bundles })
            .await
            .expect("put_events failed");
    }

    /*
    fn create_auth_token(&self) -> String {
        let header = serde_json::json!({
            "alg": "EdDSA",
            "typ": "JWT",
            "kid": hex::encode(self.key.verifying_key().as_bytes()),
        });

        let now = current_timestamp();
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
    */
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
        value: Sha256::digest(&bytes).to_vec(),
    };
    (bytes, digest)
}

fn bundle_signature(bundle: &EventBundle) -> Vec<u8> {
    bundle
        .signed_event
        .as_ref()
        .expect("bundle missing signed_event")
        .signature
        .clone()
}

fn sign(signing_key: &SigningKey, event: Event) -> SignedEvent {
    let event_bytes = event.encode_to_vec();
    let signature = signing_key.sign(&event_bytes).to_bytes().to_vec();
    SignedEvent {
        signature,
        event_bytes,
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

pub fn current_timestamp() -> u64 {
    SystemTime::UNIX_EPOCH.elapsed().unwrap().as_millis() as u64
}

pub fn random_strings(
    min_length: usize,
    max_length: usize,
    str_min_length: usize,
    str_max_length: usize,
) -> Vec<String> {
    let mut strings =
        Vec::with_capacity(rand::random_range(min_length..=max_length));
    for _ in 0..strings.capacity() {
        strings.push(random_string(str_min_length, str_max_length));
    }
    strings
}

pub fn optional_random_string(
    min_length: usize,
    max_length: usize,
) -> Option<String> {
    if rand::random() {
        Some(random_string(min_length, max_length))
    } else {
        None
    }
}

pub fn random_string(min_length: usize, max_length: usize) -> String {
    let length = rand::random_range(min_length..=max_length);
    SampleString::sample_string(&Alphabetic, &mut rand::rng(), length)
}
