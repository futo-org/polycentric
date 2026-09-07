use crate::client::PolycentricClient;
use crate::lock::LockRecover;
use crate::media::process_image;
use crate::pairing;
use crate::sync;
use polycentric_common::models::identity::assemble_recovery_payload;
use polycentric_common::models::protos_v2::{
    ContentDigest, Event, GetAttributedToReactionCountsRequest, GetServerInfoRequest, Identity,
    ListEventsResponse, PublicKey, PutEventsRequest, SetBanStatusRequest, SignedEvent,
    SignedMessage, UploadBlobRequest, UrlInfoRequest, content_service_client::ContentServiceClient,
    event_sync_service_client::EventSyncServiceClient,
    identity_service_client::IdentityServiceClient,
    notification_service_client::NotificationServiceClient,
    server_service_client::ServerServiceClient,
};
use polycentric_common::models::protos_v2::{ListHeadsRequest, PutEventsResponse};
use polycentric_common::models::traits::Serializable;
use prost::Message;
use std::sync::LazyLock;
use std::sync::{Arc, Mutex};

#[cfg(all(not(target_arch = "wasm32"), not(feature = "native-transport")))]
compile_error!("rs-core on a non-wasm target requires the `native-transport` feature.");

async fn channel(server_url: &str) -> Result<crate::query::GrpcChannel, CoreError> {
    crate::query::channel(server_url)
        .await
        .map_err(CoreError::Network)
}

/// Install a panic hook that logs the panic message
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn install_panic_hook() {
    let lazy = LazyLock::new(|| {
        std::panic::set_hook(Box::new(|info| {
            let location = info
                .location()
                .map(|l| format!("{}:{}", l.file(), l.line()))
                .unwrap_or_else(|| "unknown location".to_string());
            let msg = crate::logging::panic_payload_message(info.payload());
            crate::logging::log_error(|| format!("panic at {location}: {msg}"));
        }))
    });
    LazyLock::force(&lazy);
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
#[uniffi(flat_error)]
pub enum CoreError {
    #[error("Decode: {0}")]
    Decode(String),

    #[error("Encode: {0}")]
    Encode(String),

    #[error("Crypto: {0}")]
    Crypto(String),

    #[error("Store: {0}")]
    Store(String),

    #[error("Image: {0}")]
    Image(String),

    #[error("Network: {0}")]
    Network(String),

    #[error("Callback: {0}")]
    Callback(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

impl From<uniffi::UnexpectedUniFFICallbackError> for CoreError {
    fn from(e: uniffi::UnexpectedUniFFICallbackError) -> Self {
        CoreError::Callback(e.reason)
    }
}

#[derive(uniffi::Record)]
pub struct ContentEntry {
    pub digest_bytes: Vec<u8>,
    pub content_bytes: Vec<u8>,
}

/// Discriminated union over every observable RPC. `fetch_query`
/// matches on a variant and dispatches to the corresponding helper.
/// Adding a new observable RPC means adding a variant here and a
/// match arm in `fetch_query` — no new FFI method required.
#[derive(uniffi::Enum)]
pub enum Query {
    GetProfile(crate::query::profile::GetProfileArgs),
    GetEvent(crate::query::event::GetEventArgs),
    GetPostThread(crate::query::feed::GetPostThreadArgs),
    GetIdentityFeed(crate::query::feed::GetIdentityFeedArgs),
    GetFollowingFeed(crate::query::feed::GetFollowingFeedArgs),
    GetRecommendedFeed(crate::query::feed::GetFollowingFeedArgs),
    GetExploreFeed(crate::query::feed::GetExploreFeedArgs),
    GetAttributionFeed(crate::query::feed::GetAttributionFeedArgs),
    ListNotifications(crate::query::notification::ListNotificationsArgs),
    ListEvents(crate::query::event::ListEventsArgs),
    ListVerificationClaims(crate::query::verifications::ListVerificationClaimsArgs),
    ListVerificationTargets(crate::query::verifications::ListVerificationTargetsArgs),
    ListVerificationVerifies(crate::query::verifications::ListVerificationVerifiesArgs),
    ListTargetedVerificationClaims(crate::query::verifications::ListTargetedVerificationClaimsArgs),
    ResolveVerifiedClaims(crate::query::verifications::ResolveVerifiedClaimsArgs),
    ListFollowing(crate::query::graph::ListFollowingArgs),
    ListFollowers(crate::query::graph::ListFollowersArgs),
    SuggestFollow(crate::query::graph::SuggestFollowArgs),
    SearchPosts(crate::query::search::SearchPostsArgs),
    SearchUsers(crate::query::search::SearchUsersArgs),
    IsModerator(crate::query::moderation::IsModeratorArgs),
    IsBanned(crate::query::moderation::IsBannedArgs),
    ListBans(crate::query::moderation::ListBansArgs),
    GetReactions(crate::query::reactions::GetReactionsArgs),
}

// See AuthTokenProvider: single-threaded wasm32 wants non-Send futures.
#[uniffi::export(with_foreign)]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait SignBytesCallback: Send + Sync {
    async fn sign(&self, bytes: Vec<u8>) -> Result<Vec<u8>, CoreError>;
}

#[derive(uniffi::Object)]
pub struct PolycentricCore {
    client: Arc<Mutex<PolycentricClient>>,
    query_client: crate::query::QueryClient<Vec<u8>>,
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl PolycentricCore {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        #[cfg(target_arch = "wasm32")]
        console_error_panic_hook::set_once();
        #[cfg(not(target_arch = "wasm32"))]
        install_panic_hook();

        let client = Arc::new(Mutex::new(PolycentricClient::new()));
        Arc::new(Self {
            query_client: crate::query::QueryClient::new(client.clone()),
            client,
        })
    }

    /// Replace the list of gRPC servers the core's `Observable`-returning
    /// methods will fan out to.
    pub fn set_servers(&self, servers: Vec<String>) {
        self.client.lock_recover().set_servers(servers);
    }

    /// Register the provider consulted for the auth token attached to every
    /// outgoing gRPC request.
    pub fn set_auth_token_provider(
        &self,
        provider: Arc<dyn crate::query::auth::AuthTokenProvider>,
    ) {
        crate::query::auth::set_auth_token_provider(provider);
    }

    /// Drop every cached auth token — e.g. when the active identity changes.
    pub fn clear_auth_tokens(&self) {
        crate::query::auth::clear_auth_tokens();
    }

    /// Return a snapshot of the currently configured servers.
    pub fn get_servers(&self) -> Vec<String> {
        self.client.lock_recover().servers()
    }

    /// Set the user's identity for user-specific state (i.e. the set of identities
    /// a user blocks).
    pub fn set_active_identity(&self, identity: Option<String>) {
        self.client.lock_recover().set_active_identity(identity);
    }

    /// Identities the active identity blocks, derived from its non-tombstoned
    /// social graph events.
    pub fn blocked_identities(&self) -> Vec<String> {
        self.client
            .lock_recover()
            .blocked_identities()
            .iter()
            .cloned()
            .collect()
    }

    pub fn is_blocked(&self, identity: String) -> bool {
        self.client.lock_recover().is_blocked(&identity)
    }

    pub fn next_sequence(&self, identity: String, collection: i32) -> u64 {
        self.client
            .lock_recover()
            .next_sequence(&identity, collection)
    }

    /// Max sequence of identity events signed by `signer` for `identity`,
    /// or `None` if this signer has no identity events.
    pub fn get_identity_sequence(
        &self,
        identity: String,
        signer: Vec<u8>,
    ) -> Result<Option<u64>, CoreError> {
        let pk = PublicKey::decode(signer.as_slice())
            .map_err(|e| CoreError::Decode(format!("Failed to decode signer: {e}")))?;
        Ok(self
            .client
            .lock_recover()
            .get_identity_sequence(&identity, &pk))
    }

    /// Returns the latest known valid identity document for `identity`, if any.
    /// Derived purely from the local in-memory event and content stores.
    pub fn resolve_identity(&self, identity: String) -> Option<Vec<u8>> {
        let client = self.client.lock_recover();
        let chain = client.identity_chain(&identity).ok()?;
        chain
            .latest_state()
            .map(|document| document.encode_to_vec())
    }

    /// Returns the canonical identity chain for `identity` as a serialized
    /// `ListEventsResponse`.
    pub fn resolve_identity_chain(&self, identity: String) -> Result<Vec<u8>, CoreError> {
        let event_bundles = self
            .client
            .lock_recover()
            .identity_chain_bundles(&identity)
            .map_err(|e| CoreError::Store(format!("resolve_identity_chain: {e}")))?;

        let response = ListEventsResponse {
            event_bundles,
            event_hints: Vec::new(),
        };

        Ok(response.encode_to_vec())
    }

    /// Merkle root over the canonically-ordered signatures in
    /// `(identity, collection)`. Empty when no events exist.
    pub fn previous_root(&self, identity: String, collection: i32) -> Vec<u8> {
        self.client
            .lock_recover()
            .previous_root(&identity, collection)
    }

    /// Signature of the canonically-latest event in `(identity, collection)`.
    /// Empty when no events exist.
    pub fn previous_signature(&self, identity: String, collection: i32) -> Vec<u8> {
        self.client
            .lock_recover()
            .previous_signature(&identity, collection)
    }

    /// Verify each `SignedEvent` (decoding implicitly verifies the
    /// signature) and copy it into the local event store.
    pub fn copy_events(&self, signed_events: Vec<Vec<u8>>) -> Result<(), CoreError> {
        let mut client = self.client.lock_recover();
        for bytes in signed_events {
            let signed_event = SignedEvent::from_bytes(&bytes)
                .map_err(|e| CoreError::Decode(format!("Invalid signed event: {e:?}")))?;
            client
                .copy_event(signed_event)
                .map_err(|e| CoreError::Store(format!("Failed to copy event: {e:?}")))?;
        }
        Ok(())
    }

    /// Insert each (digest, content) pair into the content store.
    pub fn copy_contents(&self, contents: Vec<ContentEntry>) -> Result<(), CoreError> {
        let mut client = self.client.lock_recover();
        for entry in contents {
            let digest = ContentDigest::decode(entry.digest_bytes.as_slice())
                .map_err(|e| CoreError::Decode(format!("Failed to decode ContentDigest: {e}")))?;
            if let Err(e) = client.copy_content(&digest, entry.content_bytes) {
                // Skip content that doesn't match its digest; keep the rest.
                crate::logging::log_warn(|| format!("dropping content: {e}"));
            }
        }
        Ok(())
    }

    /// Build a vector clock (returns serialized `VectorClock` proto bytes).
    /// For identity events, callers should pass the new event's identity
    /// content as `identity_content` (serialized `Identity` proto bytes).
    /// For other events, leave it `None`.
    pub fn build_vector_clock(
        &self,
        identity: String,
        collection: i32,
        identity_sequence: u64,
        signed_by: Vec<u8>,
        current_sequence: u64,
        identity_content: Option<Vec<u8>>,
    ) -> Result<Vec<u8>, CoreError> {
        let pk = PublicKey::decode(signed_by.as_slice())
            .map_err(|e| CoreError::Decode(format!("Failed to decode signed_by: {e}")))?;
        let identity_content_decoded = identity_content
            .map(|bytes| Identity::decode(bytes.as_slice()))
            .transpose()
            .map_err(|e| CoreError::Decode(format!("Failed to decode identity_content: {e}")))?;
        let clock = self
            .client
            .lock_recover()
            .build_vector_clock(
                &identity,
                collection,
                identity_sequence,
                &pk,
                current_sequence,
                identity_content_decoded,
            )
            .map_err(|e| CoreError::Store(format!("build_vector_clock: {e}")))?;
        Ok(clock.encode_to_vec())
    }

    /// Decode + verify a `SignedEvent`, returning its canonical bytes.
    pub fn verify_signed_event(&self, signed_event: Vec<u8>) -> Result<Vec<u8>, CoreError> {
        let signed_event = SignedEvent::from_bytes(&signed_event)
            .map_err(|e| CoreError::Crypto(format!("Failed to verify signed event: {e}")))?;
        signed_event
            .to_bytes()
            .map_err(|e| CoreError::Encode(format!("Failed to encode signed event: {e}")))
    }

    /// Sign event bytes via a foreign callback. Validates the inner
    /// `Event`, calls the callback to produce signature bytes, assembles
    /// a `SignedEvent`, and re-verifies before returning the canonical
    /// `SignedEvent` bytes.
    pub async fn sign_event(
        &self,
        event_bytes: Vec<u8>,
        callback: Arc<dyn SignBytesCallback>,
    ) -> Result<Vec<u8>, CoreError> {
        Event::decode(event_bytes.as_slice())
            .map_err(|e| CoreError::Decode(format!("Invalid event bytes: {e}")))?;

        let signature = callback.sign(event_bytes.clone()).await?;

        let signed_event = SignedEvent {
            signature,
            event_bytes,
        };

        let signed_event_bytes = signed_event
            .to_bytes()
            .map_err(|e| CoreError::Encode(format!("Failed to encode signed event: {e}")))?;

        SignedEvent::from_bytes(&signed_event_bytes)
            .map_err(|e| CoreError::Crypto(format!("Event signature invalid: {e:?}")))?;

        Ok(signed_event_bytes)
    }

    /// Returns serialized `ListEventsResponse` proto bytes for the
    /// non-tombstoned events on (identity, collection).
    pub fn list_valid_events(
        &self,
        identity: String,
        collection: i32,
    ) -> Result<Vec<u8>, CoreError> {
        let event_bundles = self
            .client
            .lock_recover()
            .list_valid_events(&identity, collection)
            .map_err(|e| CoreError::Store(format!("list_valid_events: {e}")))?;

        let response = ListEventsResponse {
            event_bundles,
            event_hints: Vec::new(),
        };

        Ok(response.encode_to_vec())
    }

    /// Decode `image`, resize to `width`x`height` per `mode` ("fill" or
    /// "fit"), encode as JPEG.
    pub fn process_image_to_jpeg(
        &self,
        image: Vec<u8>,
        width: u32,
        height: u32,
        mode: String,
    ) -> Result<process_image::ProcessedImage, CoreError> {
        let mode = match mode.as_str() {
            "fit" => process_image::ResizeMode::Fit,
            _ => process_image::ResizeMode::Fill,
        };
        process_image::process_image(&image, width, height, mode)
            .map_err(|e| CoreError::Image(format!("process_image failed: {e}")))
    }

    // ── Network ops (gRPC / gRPC-web) ──────────────────────────────

    /// Unified entry point for every observable RPC.
    /// `query` selects which RPC to run and supplies its parameters.
    /// `query_key` is the cache key shared across subscribers.
    /// Pass in `None` to bypass the cache.
    /// `opts` carries the optional fetch mode and per-call servers override.
    /// Always returns a `QueryObservable` regardless of variant.
    pub fn fetch_query(
        &self,
        query_key: Option<crate::query::QueryKey>,
        query: Query,
        opts: Option<crate::query::QueryOpts>,
    ) -> Arc<dyn crate::query::QueryObservable> {
        match query {
            Query::GetProfile(args) => {
                crate::query::profile::get_profile(&self.query_client, query_key, args, opts)
            }
            Query::GetEvent(args) => {
                crate::query::event::get_event(&self.query_client, query_key, args, opts)
            }
            Query::GetPostThread(args) => {
                crate::query::feed::get_post_thread(&self.query_client, query_key, args, opts)
            }
            Query::GetIdentityFeed(args) => {
                crate::query::feed::get_identity_feed(&self.query_client, query_key, args, opts)
            }
            Query::GetFollowingFeed(args) => {
                crate::query::feed::get_following_feed(&self.query_client, query_key, args, opts)
            }
            Query::GetRecommendedFeed(args) => {
                crate::query::feed::get_recommended_feed(&self.query_client, query_key, args, opts)
            }
            Query::GetExploreFeed(args) => {
                crate::query::feed::get_explore_feed(&self.query_client, query_key, args, opts)
            }
            Query::GetAttributionFeed(args) => {
                crate::query::feed::get_attribution_feed(&self.query_client, query_key, args, opts)
            }
            Query::ListNotifications(args) => crate::query::notification::list_notifications(
                &self.query_client,
                query_key,
                args,
                opts,
            ),
            Query::ListEvents(args) => {
                crate::query::event::list_events(&self.query_client, query_key, args, opts)
            }
            Query::ListVerificationClaims(args) => {
                crate::query::verifications::list_verification_claims(
                    &self.query_client,
                    query_key,
                    args,
                    opts,
                )
            }
            Query::ListVerificationTargets(args) => {
                crate::query::verifications::list_verification_targets(
                    &self.query_client,
                    query_key,
                    args,
                    opts,
                )
            }
            Query::ListVerificationVerifies(args) => {
                crate::query::verifications::list_verification_verifies(
                    &self.query_client,
                    query_key,
                    args,
                    opts,
                )
            }
            Query::ListTargetedVerificationClaims(args) => {
                crate::query::verifications::list_targeted_verification_claims(
                    &self.query_client,
                    query_key,
                    args,
                    opts,
                )
            }
            Query::ResolveVerifiedClaims(args) => {
                crate::query::verifications::resolve_verified_claims(
                    &self.query_client,
                    query_key,
                    args,
                    opts,
                )
            }
            Query::ListFollowing(args) => {
                crate::query::graph::list_following(&self.query_client, query_key, args, opts)
            }
            Query::ListFollowers(args) => {
                crate::query::graph::list_followers(&self.query_client, query_key, args, opts)
            }
            Query::SuggestFollow(args) => {
                crate::query::graph::suggest_follow(&self.query_client, query_key, args, opts)
            }
            Query::SearchPosts(args) => {
                crate::query::search::search_posts(&self.query_client, query_key, args, opts)
            }
            Query::SearchUsers(args) => {
                crate::query::search::search_users(&self.query_client, query_key, args, opts)
            }
            Query::IsModerator(args) => {
                crate::query::moderation::is_moderator(&self.query_client, query_key, args, opts)
            }
            Query::IsBanned(args) => {
                crate::query::moderation::is_banned(&self.query_client, query_key, args, opts)
            }
            Query::ListBans(args) => {
                crate::query::moderation::list_bans(&self.query_client, query_key, args, opts)
            }
            Query::GetReactions(args) => {
                crate::query::reactions::get_reactions(&self.query_client, query_key, args, opts)
            }
        }
    }

    /// Clear the cache for a query key and discard the responses for any
    /// in-flight merge queries.
    pub fn invalidate_query(&self, query_key: crate::query::QueryKey) {
        self.query_client.invalidate(&query_key);
    }

    /// Clear the cache of every query key, e.g. after the configured
    /// server list changes.
    pub fn invalidate_all_queries(&self) {
        self.query_client.invalidate_all();
    }

    /// Push event bundles to a server.
    /// Returns the response from the server with any errors and missing blobs.
    pub async fn put_events(
        &self,
        server_url: String,
        event_bundles_bytes: Vec<u8>,
    ) -> Result<Vec<u8>, CoreError> {
        let request = PutEventsRequest::decode(event_bundles_bytes.as_slice())
            .map_err(|e| CoreError::Decode(format!("Failed to decode PutEventsRequest: {e}")))?;

        let mut client = EventSyncServiceClient::new(channel(&server_url).await?);
        let response = client
            .put_events(request)
            .await
            .map_err(|e| CoreError::Network(format!("put_events: {e}")))?
            .into_inner();

        let response_bytes = PutEventsResponse::encode_to_vec(&response);
        Ok(response_bytes)
    }

    /// List latest known sequence numbers from a server for a single identity.
    pub async fn list_heads(
        &self,
        server_url: String,
        request_bytes: Vec<u8>,
    ) -> Result<Vec<u8>, CoreError> {
        let request = ListHeadsRequest::decode(request_bytes.as_slice())
            .map_err(|e| CoreError::Decode(format!("Failed to decode ListHeadsRequest: {e}")))?;

        let mut client = EventSyncServiceClient::new(channel(&server_url).await?);

        let response = client
            .list_heads(request)
            .await
            .map_err(|e| CoreError::Network(format!("list_heads: {e}")))?;

        Ok(response.into_inner().encode_to_vec())
    }

    /// Push events belonging to `identity` to remote `server`.
    /// Pushes all relevant local events if `partial` is false.
    /// Otherwise, only push events that we believe the server to be missing.
    /// The server's response is returned (if there is one), so that the caller
    /// can handle error and/or push blobs.
    pub async fn push_local_events(
        &self,
        identity: String,
        server: String,
        partial: bool,
    ) -> Result<Option<Vec<u8>>, CoreError> {
        let bundles = if partial {
            let heads = sync::request_heads(&identity, &server).await?;
            let client = self.client.lock_recover();
            sync::bundle_unsent_events(&client, &identity, heads)?
        } else {
            let client = self.client.lock_recover();
            sync::bundle_local_events(&client, &identity)?
        };

        if !bundles.is_empty() {
            let response = sync::push_bundles(&server, bundles).await?;
            let encoded = PutEventsResponse::encode_to_vec(&response);
            Ok(Some(encoded))
        } else {
            Ok(None)
        }
    }

    /// Fetch a server's public info. Returns serialized
    /// `GetServerInfoResponse` proto bytes.
    pub async fn get_server_info(&self, server_url: String) -> Result<Vec<u8>, CoreError> {
        let mut client = ServerServiceClient::new(channel(&server_url).await?);
        let response = client
            .get_info(GetServerInfoRequest {})
            .await
            .map_err(|e| CoreError::Network(format!("get_server_info: {e}")))?;
        Ok(response.into_inner().encode_to_vec())
    }

    /// Fetch the maintained upvote/downvote counts for an out-of-network
    /// target. `request_bytes` is a serialized
    /// `GetAttributedToReactionCountsRequest` (carrying the AttributedTo, e.g.
    /// a link to a video URL); returns serialized
    /// `GetAttributedToReactionCountsResponse` proto bytes.
    pub async fn get_attributed_to_reaction_counts(
        &self,
        server_url: String,
        request_bytes: Vec<u8>,
    ) -> Result<Vec<u8>, CoreError> {
        let request = GetAttributedToReactionCountsRequest::decode(request_bytes.as_slice())
            .map_err(|e| {
                CoreError::Decode(format!(
                    "Failed to decode GetAttributedToReactionCountsRequest: {e}"
                ))
            })?;
        let mut client = EventSyncServiceClient::new(channel(&server_url).await?);
        let response = client
            .get_attributed_to_reaction_counts(request)
            .await
            .map_err(|e| CoreError::Network(format!("get_attributed_to_reaction_counts: {e}")))?;
        Ok(response.into_inner().encode_to_vec())
    }

    /// Upload a blob body to a server. The server verifies that `body`
    /// matches the declared `Blob.digest`.
    pub async fn upload_blob(
        &self,
        server_url: String,
        request_bytes: Vec<u8>,
    ) -> Result<(), CoreError> {
        let request = UploadBlobRequest::decode(request_bytes.as_slice())
            .map_err(|e| CoreError::Decode(format!("Failed to decode UploadBlobRequest: {e}")))?;
        let mut client = ContentServiceClient::new(channel(&server_url).await?);
        client
            .upload_blob(request)
            .await
            .map_err(|e| CoreError::Network(format!("upload_blob: {e}")))?;
        Ok(())
    }

    /// Ban or unban an identity on a server. `request_bytes` is a
    /// serialized `SetBanStatusRequest`. Returns serialized
    /// `SetBanStatusResponse` proto bytes. Requires the caller (bearer
    /// JWT) to be a moderator on the server.
    pub async fn set_ban_status(
        &self,
        server_url: String,
        request_bytes: Vec<u8>,
    ) -> Result<Vec<u8>, CoreError> {
        let request = SetBanStatusRequest::decode(request_bytes.as_slice())
            .map_err(|e| CoreError::Decode(format!("Failed to decode SetBanStatusRequest: {e}")))?;
        let mut client = IdentityServiceClient::new(channel(&server_url).await?);
        let response = client
            .set_ban_status(tonic::Request::new(request))
            .await
            .map_err(|e| CoreError::Network(format!("set_ban_status: {e}")))?;
        Ok(response.into_inner().encode_to_vec())
    }

    /// Fetch link-preview metadata for `url` from a server's unfurl endpoint.
    /// Returns serialized `Link` proto bytes.
    pub async fn url_info(&self, server_url: String, url: String) -> Result<Vec<u8>, CoreError> {
        let mut client = ContentServiceClient::new(channel(&server_url).await?);
        let response = client
            .url_info(UrlInfoRequest { url })
            .await
            .map_err(|e| CoreError::Network(format!("url_info: {e}")))?;
        Ok(response.into_inner().encode_to_vec())
    }

    /// Create or update a pairing session on the server.
    /// `signed_issuer_state` should be a serialized `SignedIssuerState` wrapping
    /// a serialized `IssuerPairingState` message.
    /// Checks that the server's response reflects the current pairing session.
    /// Returns the server's response as a serialized `PairingSessionState` message.
    pub async fn put_pairing_session(
        &self,
        server_url: String,
        signed_issuer_state: Vec<u8>,
    ) -> Result<Vec<u8>, CoreError> {
        pairing::put(&self.client, &server_url, signed_issuer_state).await
    }

    /// Fetch a pairing session by its digest's SHA256 hash.
    pub async fn get_pairing_session(
        &self,
        server_url: String,
        digest_sha256: Vec<u8>,
    ) -> Result<Vec<u8>, CoreError> {
        let session_state = pairing::fetch_session(&server_url, digest_sha256.clone()).await?;
        let state = pairing::open_state(session_state, &self.client, &digest_sha256, None)?;
        Ok(state.raw.encode_to_vec())
    }

    /// Register `claimer_key` as a claimer in the pairing session matching the digest hash.
    /// Checks the server's response to ensure the claimer is present.
    pub async fn join_pairing_session(
        &self,
        server_url: String,
        digest_sha256: Vec<u8>,
        claimer_key: crate::query::event::key::PublicKey,
    ) -> Result<(), CoreError> {
        let claimer_key: PublicKey = claimer_key.into();
        pairing::join(&self.client, server_url, digest_sha256, claimer_key).await
    }

    /// Poll function for the issuer.
    /// Returns the list of claimers for the pairing session, as specified by the server.
    pub async fn poll_for_claimers(
        &self,
        server_url: String,
        digest_sha256: Vec<u8>,
    ) -> Result<Vec<crate::query::event::key::PublicKey>, CoreError> {
        let session_state = pairing::fetch_session(&server_url, digest_sha256.clone()).await?;
        let state = pairing::open_state(session_state, &self.client, &digest_sha256, None)?;
        Ok(state.raw.claimers.into_iter().map(Into::into).collect())
    }

    /// Poll function for the claimer.
    /// Returns true when the issuer-declared identity state authorizes our public key.
    /// The caller should still pull in the full identity chain to confirm.
    pub async fn poll_for_authorization(
        &self,
        server_url: String,
        digest_sha256: Vec<u8>,
        claimer_key: crate::query::event::key::PublicKey,
    ) -> Result<bool, CoreError> {
        let session_state = pairing::fetch_session(&server_url, digest_sha256.clone()).await?;
        let state = pairing::open_state(session_state, &self.client, &digest_sha256, None)?;
        Ok(pairing::does_issuer_authorize(
            &state.issuer_state,
            &claimer_key.into(),
        ))
    }

    /// Register a push notification token. `signed_message_bytes` is a
    /// serialized `SignedMessage` wrapping a
    /// `RegisterPushNotificationRequest`.
    pub async fn register_push_notifications(
        &self,
        server_url: String,
        signed_message_bytes: Vec<u8>,
    ) -> Result<(), CoreError> {
        let signed = SignedMessage::decode(signed_message_bytes.as_slice())
            .map_err(|e| CoreError::Decode(format!("Failed to decode SignedMessage: {e}")))?;
        let mut client = NotificationServiceClient::new(channel(&server_url).await?);
        client
            .register_push_notifications(signed)
            .await
            .map_err(|e| CoreError::Network(format!("register_push_notifications: {e}")))?;
        Ok(())
    }

    /// Derive the bytes that should be signed by the recovery key in order to
    /// authorize `public_key` as a new rotation key for the identity.
    /// `public_key` should be a serialized `PublicKey` protobuf.
    pub fn assemble_recovery_payload(
        &self,
        identity: String,
        public_key: Vec<u8>,
    ) -> Result<Vec<u8>, CoreError> {
        let public_key = PublicKey::decode(public_key.as_slice())
            .map_err(|e| CoreError::Decode(format!("assemble_recovery_payload: {e}")))?;

        Ok(assemble_recovery_payload(&identity, &public_key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::panic::AssertUnwindSafe;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn poisoned_client_recovers() {
        let core = PolycentricCore::new();

        let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
            let _guard = core.client.lock().unwrap();
            panic!("poison the client");
        }));

        core.set_servers(vec!["s1".to_string()]);
        assert_eq!(core.client.lock_recover().servers(), vec!["s1".to_string()]);
    }

    struct Recording(Arc<StdMutex<Vec<String>>>);

    impl crate::logging::Logger for Recording {
        fn log(&self, message: String) {
            self.0.lock().unwrap().push(message);
        }
    }

    #[test]
    fn panics_cause_logs() {
        let messages = Arc::new(StdMutex::new(Vec::new()));
        crate::logging::set_logger(Arc::new(Recording(messages.clone())));
        crate::logging::set_log_level(crate::logging::LogLevel::Error);

        install_panic_hook();

        let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
            panic!("hook smoke test");
        }));

        let got = messages.lock().unwrap();
        assert!(
            got.iter()
                .any(|m| m.contains("panic at") && m.contains("hook smoke test")),
            "expected the panic hook to log, got {got:?}"
        );
    }
}
