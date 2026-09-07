//! Shared test fixtures: a mock polycentric gRPC backend, event-bundle
//! builders, and push-token rows.

use crate::context::Context;
use crate::manager::{NotificationManager, PushService};
use crate::polycentric::PolycentricClient;
use polycentric_common::models::{
    collections,
    protos_v2::{
        Content, Event, EventBundle, EventKey, GetAttributedToReactionCountsRequest,
        GetAttributedToReactionCountsResponse, GetReactionsRequest, GetReactionsResponse, Identity,
        KeyType, ListEventsRequest, ListEventsResponse, ListHeadsRequest, ListHeadsResponse, Post,
        PostReply, ProfileUpdate, PublicKey, PutEventsRequest, PutEventsResponse,
        SerializedContent, SignedEvent,
        content::ContentBody,
        event_sync_service_server::{EventSyncService, EventSyncServiceServer},
    },
};
use prost::Message;
use push_notifications_entity::push_token_model as PushTokenModel;
use sea_orm::DatabaseConnection;
use time::OffsetDateTime;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{Request, Response, Status};

/// A mock `EventSyncService` that answers `ListEvents` with canned data
/// per collection: a PROFILE event carrying `profile_name`, and an
/// IDENTITY event carrying `identity_keys`. Every other query is empty.
#[derive(Clone)]
pub struct MockEventSync {
    pub profile_name: Option<String>,
    pub identity_keys: Vec<PublicKey>,
}

#[tonic::async_trait]
impl EventSyncService for MockEventSync {
    async fn list_events(
        &self,
        request: Request<ListEventsRequest>,
    ) -> Result<Response<ListEventsResponse>, Status> {
        let collection = request.into_inner().filters.and_then(|f| f.collection);

        let event_bundles = match collection {
            Some(c) if c == collections::PROFILE => self
                .profile_name
                .clone()
                .map(|name| {
                    vec![canned_bundle(Content {
                        content_body: Some(ContentBody::ProfileUpdate(ProfileUpdate {
                            name: Some(name),
                            avatar: None,
                            banner: None,
                            description: None,
                            alias: None,
                        })),
                    })]
                })
                .unwrap_or_default(),
            Some(c) if c == collections::IDENTITY => {
                if self.identity_keys.is_empty() {
                    vec![]
                } else {
                    vec![canned_bundle(Content {
                        content_body: Some(ContentBody::Identity(Identity {
                            rotation_keys: vec![],
                            signing_keys: self.identity_keys.clone(),
                            revocation_bounds: vec![],
                            servers: None,
                            recovery_key: None,
                            recovery_signature: None,
                        })),
                    })]
                }
            }
            _ => vec![],
        };

        Ok(Response::new(ListEventsResponse {
            event_bundles,
            event_hints: vec![],
        }))
    }

    async fn put_events(
        &self,
        _request: Request<PutEventsRequest>,
    ) -> Result<Response<PutEventsResponse>, Status> {
        Ok(Response::new(PutEventsResponse {
            errors: vec![],
            requested_blobs: vec![],
        }))
    }

    async fn list_heads(
        &self,
        _request: Request<ListHeadsRequest>,
    ) -> Result<Response<ListHeadsResponse>, Status> {
        Err(Status::unimplemented("not needed for these tests"))
    }

    async fn get_reactions(
        &self,
        _request: Request<GetReactionsRequest>,
    ) -> Result<Response<GetReactionsResponse>, Status> {
        Err(Status::unimplemented("not needed for these tests"))
    }

    async fn get_attributed_to_reaction_counts(
        &self,
        _request: Request<GetAttributedToReactionCountsRequest>,
    ) -> Result<Response<GetAttributedToReactionCountsResponse>, Status> {
        Err(Status::unimplemented("not needed for these tests"))
    }
}

/// Spawn `mock` on an ephemeral local port and return a client pointed
/// at it. The listener is bound before serving, so the lazily-connecting
/// client never races the bind.
pub async fn spawn_polycentric(mock: MockEventSync) -> PolycentricClient {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(EventSyncServiceServer::new(mock))
            .serve_with_incoming(TcpListenerStream::new(listener))
            .await
            .unwrap();
    });
    PolycentricClient::new(vec![format!("http://{addr}")])
}

/// Wrap `content` in a minimal bundle. `latest_content` only decodes —
/// it never verifies — so an unsigned, sequence-1 event suffices.
fn canned_bundle(content: Content) -> EventBundle {
    authored_bundle("", content)
}

/// Build a bundle authored by `author` carrying `content`.
pub fn authored_bundle(author: &str, content: Content) -> EventBundle {
    let event = Event {
        key: Some(EventKey {
            collection: collections::FEED,
            identity: author.to_string(),
            // Known signing key so post_url's fingerprint (first 8 bytes
            // as hex → "abababababababab") is deterministic/assertable.
            signed_by: Some(PublicKey {
                key_type: KeyType::Ed25519 as i32,
                key: vec![0xAB; 32],
            }),
            sequence: 1,
        }),
        identity_sequence: 0,
        vector_clock: None,
        previous_signature: vec![],
        content_digest: None,
        created_at: 0,
        previous_root: vec![],
        application: None,
    };
    EventBundle {
        signed_event: Some(SignedEvent {
            // Non-empty 64-byte signature (bytes 0x00..0x3f) so collapse_id
            // derivation — hex of the first 28 bytes, with no type prefix —
            // is exercised and assertable by the happy-path tests.
            signature: (0u8..64).collect(),
            event_bytes: event.encode_to_vec(),
        }),
        serialized_content: Some(SerializedContent {
            content_bytes: content.encode_to_vec(),
        }),
        event_proofs: vec![],
        meta: None,
    }
}

/// A post by `author` (body "hi") replying to another identity's post.
pub fn reply_post_bundle(author: &str) -> EventBundle {
    authored_bundle(
        author,
        Content {
            content_body: Some(ContentBody::Post(Post {
                text: "hi".to_string(),
                reply: Some(PostReply {
                    root: None,
                    parent: Some(EventKey {
                        collection: collections::FEED,
                        identity: "id-recipient".to_string(),
                        signed_by: None,
                        sequence: 1,
                    }),
                }),
                images: vec![],
                links: vec![],
                quote: None,
                labels: vec![],
                attributed_to: vec![],
            })),
        },
    )
}

/// A registered Expo `push_token` row for `public_key`.
pub fn token_row(public_key: &[u8], token: &str) -> PushTokenModel::Model {
    PushTokenModel::Model {
        public_key_type: KeyType::Ed25519 as i16,
        public_key: public_key.to_vec(),
        service: PushService::Expo.as_ref().to_string(),
        token: token.to_string(),
        created_at: OffsetDateTime::UNIX_EPOCH,
        updated_at: OffsetDateTime::UNIX_EPOCH,
    }
}

pub fn test_public_key(byte: u8) -> PublicKey {
    PublicKey {
        key_type: KeyType::Ed25519 as i32,
        key: vec![byte; 32],
    }
}

pub fn make_ctx(
    db: DatabaseConnection,
    expo_push_url: String,
    polycentric: PolycentricClient,
) -> Context {
    Context {
        db: db.clone(),
        ro_db: db,
        notification_manager: NotificationManager::with_custom_push_url(None, expo_push_url),
        polycentric,
        main_server: String::new(),
    }
}

/// Whether the mock DB recorded a DELETE against `push_token`. Consumes
/// the connection (it drains the transaction log).
pub fn saw_push_token_delete(db: DatabaseConnection) -> bool {
    db.into_transaction_log().iter().any(|tx| {
        tx.statements().iter().any(|stmt| {
            let sql = stmt.sql.to_ascii_uppercase();
            sql.starts_with("DELETE") && sql.contains("PUSH_TOKEN")
        })
    })
}
