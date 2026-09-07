use polycentric_common::{
    error::CoreError,
    models::{
        Serializable, collections,
        identity::IdentityChain,
        protos_v2::{
            self, Content, ContentDigest, Event, EventBundle, EventMetadata, EventProof, Identity,
            PublicKey, SerializedContent, SignedEvent, VectorClock, content::ContentBody,
        },
    },
};

use crate::lock::LockRecover;
use crate::store::{
    content_store::ContentStore, event_proofs_store::EventProofsStore, event_store::EventStore,
    identity_store::IdentityStore, keys::EventKey, meta_store::MetaStore,
    pairing_store::PairingStore,
};
use prost::Message;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

fn hex_short(bytes: &[u8]) -> String {
    hex::encode(&bytes[..bytes.len().min(4)])
}

/// Identity named by a `Block` bundle, if the bundle is one.
fn block_target(bundle: &EventBundle) -> Option<String> {
    let bytes = &bundle.serialized_content.as_ref()?.content_bytes;
    match Content::decode(bytes.as_slice()).ok()?.content_body? {
        ContentBody::Block(block) => Some(block.identity),
        _ => None,
    }
}

#[derive(Default)]
pub struct PolycentricClient {
    servers: Mutex<Vec<String>>,
    active_identity: Mutex<Option<String>>,
    blocked_identities: Mutex<Option<Arc<HashSet<String>>>>,
    event_store: EventStore,
    event_proofs_store: EventProofsStore,
    content_store: ContentStore,
    meta_store: MetaStore,
    identity_store: IdentityStore,
    pairing_store: PairingStore,
}

impl PolycentricClient {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace the list of gRPC servers this client knows about.
    pub fn set_servers(&self, servers: Vec<String>) {
        *self.servers.lock_recover() = servers;
    }

    /// Return a snapshot of the configured servers.
    pub fn servers(&self) -> Vec<String> {
        self.servers.lock_recover().clone()
    }

    /// Set the identity whose local state the client reads for viewer-specific
    /// rules, such as blocking posts from the user's blocked list
    pub fn set_active_identity(&self, identity: Option<String>) {
        *self.active_identity.lock_recover() = identity;
        self.blocked_identities.lock_recover().take();
    }

    pub fn active_identity(&self) -> Option<String> {
        self.active_identity.lock_recover().clone()
    }

    /// Identities the active identity blocks, derived from its non-tombstoned
    /// social graph events. Empty when there is no active identity. Memoized
    /// until a copy into the event or content store invalidates it.
    pub fn blocked_identities(&self) -> Arc<HashSet<String>> {
        if let Some(cached) = self.blocked_identities.lock_recover().clone() {
            return cached;
        }

        let blocked = Arc::new(match self.active_identity() {
            None => HashSet::new(),
            Some(active) => match self.list_valid_events(&active, collections::SOCIAL_GRAPH) {
                Ok(bundles) => bundles.iter().filter_map(block_target).collect(),
                Err(e) => {
                    crate::logging::log_warn(|| format!("blocked identities unavailable: {e:?}"));
                    HashSet::new()
                }
            },
        });

        *self.blocked_identities.lock_recover() = Some(Arc::clone(&blocked));
        blocked
    }

    pub fn is_blocked(&self, identity: &str) -> bool {
        self.blocked_identities().contains(identity)
    }

    /// Copy a signed event into the event store.
    pub fn copy_event(&mut self, signed_event: SignedEvent) -> Result<(), CoreError> {
        self.blocked_identities.lock_recover().take();

        let event_key = EventKey::from_signed_event(&signed_event)?;
        let identity =
            (event_key.collection == collections::IDENTITY).then(|| event_key.identity.clone());

        // Do the insertion
        let inserted = self.event_store.insert_at(signed_event, event_key);

        // If we inserted an identity event, invalidate the relevant identity chain
        if inserted && let Some(identity) = identity {
            self.identity_store.invalidate(&identity);
        }

        Ok(())
    }

    /// Copy content bytes into the content store, keyed by digest, after
    /// verifying the bytes hash to that digest. Mismatched (or
    /// unsupported-digest) content is rejected and not stored.
    pub fn copy_content(
        &mut self,
        digest: &ContentDigest,
        content_bytes: Vec<u8>,
    ) -> Result<(), CoreError> {
        if digest.verify_against(&content_bytes).is_err() {
            let digest_hex: String = hex::encode(digest.value.as_slice());
            return Err(CoreError::InvalidEvent(format!(
                "content does not match digest {digest_hex}"
            )));
        }

        self.blocked_identities.lock_recover().take();

        if !self.content_store.insert(digest, content_bytes) {
            return Ok(());
        }

        // Adding this content may make an identity chain resolve differently if
        // it's an identity document.
        let is_identity = self
            .content_store
            .get_decoded(digest)
            .and_then(|content| content.content_body)
            .is_some_and(|body| matches!(body, ContentBody::Identity(_)));

        if is_identity {
            self.identity_store.invalidate_all();
        }

        Ok(())
    }

    /// Copy event metadata into the meta store.
    pub fn copy_meta(&mut self, event_key: EventKey, meta: EventMetadata) {
        self.meta_store.include(event_key, meta);
    }

    /// First locally-valid bundle at `(identity, collection, sequence)`.
    /// `signer_key_prefix` is a hex prefix of the signing key, used to pick
    /// between events different keys published at the same sequence.
    pub fn find_event_bundle_by_sequence(
        &self,
        identity: &str,
        collection: i32,
        sequence: u64,
        signer_key_prefix: Option<&str>,
    ) -> Option<EventBundle> {
        let candidates = self.list_valid_events(identity, collection).ok()?;

        for bundle in candidates {
            let Some(key) = bundle
                .signed_event
                .as_ref()
                .and_then(|signed_event| Event::decode(signed_event.event_bytes.as_slice()).ok())
                .and_then(|event| event.key)
            else {
                continue;
            };
            if key.sequence != sequence {
                continue;
            }
            let signer_matches = match (signer_key_prefix, key.signed_by.as_ref()) {
                (None, _) => true,
                (Some(prefix), Some(signer)) => hex::encode(&signer.key).starts_with(prefix),
                (Some(_), None) => false,
            };
            if signer_matches {
                return Some(bundle);
            }
        }

        None
    }

    pub fn find_content_from_digest(&self, digest: &ContentDigest) -> Option<SerializedContent> {
        self.content_store
            .get(digest)
            .map(|bytes| SerializedContent {
                content_bytes: Vec::from(bytes),
            })
    }

    /// Find the event metadata corresponding to `event_key`.
    pub fn find_event_meta(&self, event_key: &EventKey) -> Option<&EventMetadata> {
        self.meta_store.get(event_key)
    }

    /// Assemble the stored bundle for an event already located in the store.
    pub(crate) fn bundle_for(
        &self,
        key: &EventKey,
        signed_event: &SignedEvent,
        include_proofs: bool,
    ) -> Result<EventBundle, CoreError> {
        let event = Event::decode(signed_event.event_bytes.as_slice())
            .map_err(|e| CoreError::InvalidEvent(format!("Failed to decode event: {}", e)))?;

        let serialized_content = event
            .content_digest
            .as_ref()
            .and_then(|digest| self.find_content_from_digest(digest));

        let event_proofs = if include_proofs {
            self.event_proofs_store.get(key).to_vec()
        } else {
            Vec::new()
        };

        Ok(EventBundle {
            signed_event: Some(signed_event.clone()),
            serialized_content,
            event_proofs,
            meta: self.meta_store.get(key).cloned(),
        })
    }

    /// Sig-check and insert each bundle. Identity events go first (by
    /// sequence) so downstream validation can find the genesis. Any
    /// `event_proofs` travelling with a bundle are persisted in the
    /// proofs side-store so read-side validation can re-verify revoked
    /// signers later.
    pub fn copy_bundles(&mut self, bundles: Vec<EventBundle>) {
        let mut prepared: Vec<(Event, EventBundle)> = bundles
            .into_iter()
            .filter_map(|bundle| {
                let event = bundle.signed_event.as_ref()?.open().ok()?;
                Some((event, bundle))
            })
            .collect();

        prepared.sort_by_key(|(event, _)| {
            let collection = event.key.as_ref().map(|k| k.collection).unwrap_or(i32::MAX);
            let identity_first = if collection == collections::IDENTITY {
                0
            } else {
                1
            };
            let sequence = event.key.as_ref().map(|k| k.sequence).unwrap_or(0);
            (identity_first, sequence)
        });

        for (event, bundle) in prepared {
            let digest = event.content_digest.as_ref();
            let serialized = bundle.serialized_content;
            let proofs = bundle.event_proofs;

            if let (Some(digest), Some(content)) = (digest, serialized)
                && let Err(e) = self.copy_content(digest, content.content_bytes)
            {
                // Keep the validly-signed event; just drop the bad content.
                crate::logging::log_warn(|| format!("dropping content: {e}"));
            }
            if let Ok(key) = EventKey::from_event(event) {
                if !proofs.is_empty() {
                    self.event_proofs_store.insert(key.clone(), proofs);
                }
                if let Some(meta) = bundle.meta {
                    self.copy_meta(key, meta);
                }
            }
            if let Some(signed_event) = bundle.signed_event {
                let _ = self.copy_event(signed_event);
            }
        }
    }

    pub fn get_sync_events(
        &self,
        identity: &str,
        collection: i32,
        signer_key_type: i32,
        signer_key: &[u8],
        sequence_gt: u64,
    ) -> impl DoubleEndedIterator<Item = (&EventKey, &SignedEvent)> {
        self.event_store.by_identity_collection_signer(
            identity,
            collection,
            signer_key_type,
            signer_key,
            sequence_gt,
        )
    }

    /// Get all local events belonging to `identity`.
    pub fn get_local_events(
        &self,
        identity: &str,
    ) -> impl Iterator<Item = (&EventKey, &SignedEvent)> {
        self.event_store.by_identity(identity)
    }

    /// Finds the collections and signers referenced by local events of
    /// the given identity.
    /// These values are derived solely from the event keys in the event store
    /// without further aggregation or validity checking.
    pub fn find_collections_and_signers(&self, identity: &str) -> (Vec<i32>, Vec<PublicKey>) {
        self.event_store.find_collections_and_signers(identity)
    }

    /// Max `sequence` of identity events signed by `signer` for `identity`,
    /// or `None` if this signer has no identity events.
    pub fn get_identity_sequence(
        &self,
        identity: &str,
        signer: &protos_v2::PublicKey,
    ) -> Option<u64> {
        self.event_store
            .by_identity_collection_signer(
                identity,
                collections::IDENTITY,
                signer.key_type,
                &signer.key,
                0,
            )
            .next_back()
            .map(|(k, _)| k.sequence)
    }

    /// `max(sequence) + 1` over validated events in `(identity, collection)`,
    /// or 1 if none exist.
    pub fn next_sequence(&self, identity: &str, collection: i32) -> u64 {
        self.event_store
            .by_identity_and_collection(identity, collection)
            .filter(|(k, signed)| {
                self.validate_event(signed, self.event_proofs_store.get(k))
                    .is_ok()
            })
            .map(|(k, _)| k.sequence)
            .max()
            .map(|s| s + 1)
            .unwrap_or(1)
    }

    /// Canonically-ordered signatures in `(identity, collection)`.
    /// Delegates to [`polycentric_common::merkle::canonical_signatures`]
    /// so client and server agree on the ordering.
    fn canonical_signatures(&self, identity: &str, collection: i32) -> Vec<Vec<u8>> {
        polycentric_common::merkle::canonical_signatures(
            self.event_store
                .by_identity_and_collection(identity, collection)
                .map(|(_, se)| (se.event_bytes.as_slice(), se.signature.as_slice())),
        )
    }

    /// Merkle root over canonically-ordered signatures in `(identity, collection)`.
    pub fn previous_root(&self, identity: &str, collection: i32) -> Vec<u8> {
        let leaves = self.canonical_signatures(identity, collection);
        polycentric_common::merkle::merkle_tree_hash(&leaves)
            .map(|h| h.to_vec())
            .unwrap_or_default()
    }

    /// Signature of the canonically-latest event in `(identity, collection)`,
    /// or empty if none.
    pub fn previous_signature(&self, identity: &str, collection: i32) -> Vec<u8> {
        self.canonical_signatures(identity, collection)
            .pop()
            .unwrap_or_default()
    }

    /// Build a vector clock for a single collection within an identity.
    pub fn build_vector_clock(
        &self,
        identity: &str,
        collection: i32,
        identity_sequence: u64,
        current_signer: &PublicKey,
        current_sequence: u64,
        identity_content: Option<Identity>,
    ) -> Result<VectorClock, CoreError> {
        let chain = self.identity_chain(identity)?;

        let identity_content = match identity_content {
            Some(doc) => doc,
            None => chain
                .state_at_sequence(identity_sequence)
                .ok_or_else(|| {
                    CoreError::InvalidEvent(format!(
                        "No validated identity event at sequence {}",
                        identity_sequence
                    ))
                })?
                .clone(),
        };

        // One entry per dedup key: self → current_sequence, others →
        // max validated sequence observed in this collection.
        let sequence = identity_content
            .deduplicated_keys()
            .into_iter()
            .map(|pk| {
                if pk.key_type == current_signer.key_type && pk.key == current_signer.key {
                    current_sequence
                } else {
                    self.event_store
                        .by_identity_collection_signer(
                            identity,
                            collection,
                            pk.key_type,
                            &pk.key,
                            0,
                        )
                        .rev()
                        .find(|(k, signed)| {
                            self.validate_event(signed, self.event_proofs_store.get(k))
                                .is_ok()
                        })
                        .map(|(k, _)| k.sequence)
                        .unwrap_or(0)
                }
            })
            .collect();

        Ok(VectorClock { sequence })
    }

    /// Valid bundles for `(identity, collection)`, excluding any tombstoned
    /// by a `Delete` event in the same collection.
    pub fn list_valid_events(
        &self,
        identity: &str,
        collection: i32,
    ) -> Result<Vec<EventBundle>, CoreError> {
        let mut bundles: Vec<(EventKey, EventBundle)> = Vec::new();
        let mut tombstoned: HashSet<EventKey> = HashSet::new();

        for (event_key, signed_event) in self
            .event_store
            .by_identity_and_collection(identity, collection)
        {
            let proofs = self.event_proofs_store.get(event_key);
            if self.validate_event(signed_event, proofs).is_err() {
                continue;
            }
            let bundle = self.bundle_for(event_key, signed_event, true)?;

            if let Some(bytes) = bundle
                .serialized_content
                .as_ref()
                .map(|c| c.content_bytes.as_slice())
                && let Ok(content) = Content::decode(bytes)
                && let Some(ContentBody::Delete(d)) = content.content_body
                && let Some(target) = d.event_key
                && let Some(signed_by) = target.signed_by
            {
                tombstoned.insert(EventKey {
                    identity: target.identity,
                    collection: target.collection,
                    signed_by_key_type: signed_by.key_type,
                    signed_by_key: signed_by.key,
                    sequence: target.sequence,
                });
            }

            bundles.push((event_key.clone(), bundle));
        }

        Ok(bundles
            .into_iter()
            .filter(|(k, _)| !tombstoned.contains(k))
            .map(|(_, b)| b)
            .collect())
    }

    /// Return the identity chain for `identity`, resolved from the local event and
    /// content stores.
    pub fn identity_chain(&self, identity: &str) -> Result<Arc<IdentityChain>, CoreError> {
        self.identity_store
            .get_chain(identity, &self.event_store, &self.content_store)
    }

    /// The canonical identity chain for `identity` as bundles.
    pub fn identity_chain_bundles(&self, identity: &str) -> Result<Vec<EventBundle>, CoreError> {
        let chain = self.identity_chain(identity)?;

        chain
            .iter()
            .map(|identity_event| {
                let key = EventKey {
                    identity: identity.to_owned(),
                    collection: collections::IDENTITY,
                    signed_by_key_type: identity_event.signer.key_type,
                    signed_by_key: identity_event.signer.key.clone(),
                    sequence: identity_event.sequence,
                };

                let signed_event = self.event_store.get(&key).ok_or_else(|| {
                    CoreError::InvalidEvent(format!(
                        "identity chain event at sequence {} for {} is not in the event store",
                        identity_event.sequence, identity
                    ))
                })?;

                self.bundle_for(&key, signed_event, true)
            })
            .collect()
    }

    /// Ensure that the pairing store considers `sequence` to be an observed sequence
    /// for the specified pairing session.
    pub fn accept_pairing_sequence(&mut self, digest_sha256: &[u8], sequence: i64) {
        self.pairing_store.accept_sequence(digest_sha256, sequence);
    }

    /// Returns whether a pairing session state with this sequence should be used.
    /// This should be called for every pairing session state we receive from a remote.
    pub fn try_pairing_sequence(&mut self, digest_sha256: &[u8], sequence: i64) -> bool {
        self.pairing_store.try_sequence(digest_sha256, sequence)
    }

    /// Validate an event against its identity chain, identity content,
    /// revocation status, and vector clock.
    pub fn validate_event(
        &self,
        signed_event: &SignedEvent,
        proofs: &[EventProof],
    ) -> Result<(), CoreError> {
        let event = protos_v2::Event::from_bytes(&signed_event.event_bytes)
            .map_err(|e| CoreError::DeserializationError(e.to_string()))?;

        let key = event.key.ok_or_else(|| {
            CoreError::DeserializationError("Deserialized event has no key".to_owned())
        })?;
        let signer = key.signed_by.ok_or_else(|| {
            CoreError::DeserializationError("Event key has no signed_by".to_owned())
        })?;

        let chain = self.identity_chain(&key.identity)?;
        let head = chain.latest_event().ok_or_else(|| {
            CoreError::InvalidEvent(format!(
                "Validated identity chain for {} is empty",
                key.identity
            ))
        })?;

        // Identity events: in-chain means validated, else forgery.
        if key.collection == collections::IDENTITY {
            let in_chain = chain.iter().any(|e| {
                e.sequence == key.sequence
                    && e.signer.key_type == signer.key_type
                    && e.signer.key == signer.key
            });
            if in_chain {
                return Ok(());
            }
            return Err(CoreError::InvalidEvent(format!(
                "Identity event at sequence {} for {} (signer {}) is not part of the validated chain (head at {})",
                key.sequence,
                key.identity,
                hex_short(&signer.key),
                head.sequence
            )));
        }

        let vc = event
            .vector_clock
            .as_ref()
            .ok_or_else(|| CoreError::InvalidEvent("Event missing vector_clock".into()))?;

        let signer_identity_content =
            chain.state_at_sequence(event.identity_sequence).ok_or_else(|| {
                CoreError::InvalidEvent(format!(
                    "Event references identity_sequence {} for identity {} but that is outside the validated chain (head at sequence {})",
                    event.identity_sequence, key.identity, head.sequence
                ))
            })?;

        if !signer_identity_content.authorizes_signer(&signer) {
            return Err(CoreError::InvalidEvent(format!(
                "Signer {} is not authorized by the identity content at sequence {} for identity {}",
                hex_short(&signer.key),
                event.identity_sequence,
                key.identity
            )));
        }

        // Revoked signer: must be the head named by the target, or have an
        // EventProof against it.
        if !head.document.authorizes_signer(&signer) {
            let target = chain
                .revocation_target_for(&signer, key.collection)
                .ok_or_else(|| {
                    CoreError::InvalidEvent(format!(
                        "Signer {} was revoked from identity {} but no target was recorded for collection {} (post-revocation forgery)",
                        hex_short(&signer.key),
                        key.identity,
                        key.collection,
                    ))
                })?;
            if signed_event.signature != target.signature {
                let proof = proofs
                    .iter()
                    .find(|p| p.target_signature == target.signature)
                    .ok_or_else(|| {
                        CoreError::InvalidEvent(format!(
                            "Signer {} was revoked from identity {}; missing EventProof against target for collection {} at seq:{} (post-revocation forgery)",
                            hex_short(&signer.key),
                            key.identity,
                            key.collection,
                            key.sequence,
                        ))
                    })?;
                polycentric_common::merkle::verify_proof(
                    &signed_event.signature,
                    proof.leaf_index,
                    target,
                    &proof.audit_path,
                )?;
            }
        }

        // Content is valid once its signature and signer authorization check
        // out. The vector clock still has to be structurally sound, but a
        // referenced event we haven't synced is a gap to backfill, not grounds
        // to reject — so the missing list is allowed to be non-empty here.
        crate::vector_clock::verify_vector_clock(
            &self.event_store,
            vc,
            signer_identity_content,
            &key.identity,
            key.collection,
            &signer,
            key.sequence,
        )?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use polycentric_common::models::protos_v2::{
        ContentDigestType, EventKey as ProtoEventKey, EventProofTarget, Identity, KeyType, Post,
        RevocationBound, content::ContentBody as Body,
    };
    use sha2::{Digest as ShaDigest, Sha256};
    use std::collections::HashMap;

    struct Keypair {
        signing: SigningKey,
        public: PublicKey,
    }

    fn keypair(seed: u8) -> Keypair {
        let signing = SigningKey::from_bytes(&[seed; 32]);
        let public = PublicKey {
            key_type: KeyType::Ed25519 as i32,
            key: signing.verifying_key().to_bytes().to_vec(),
        };
        Keypair { signing, public }
    }

    fn sha256_digest(bytes: &[u8]) -> ContentDigest {
        let digest = Sha256::digest(bytes).to_vec();
        ContentDigest {
            r#type: ContentDigestType::Sha256 as i32,
            value: digest,
        }
    }

    fn identity_content(
        rotation: Vec<PublicKey>,
        signing: Vec<PublicKey>,
        revocation_bounds: Vec<RevocationBound>,
    ) -> (Vec<u8>, ContentDigest) {
        let content = Content {
            content_body: Some(Body::Identity(Identity {
                rotation_keys: rotation,
                signing_keys: signing,
                revocation_bounds,
                servers: None,
                recovery_key: None,
                recovery_signature: None,
            })),
        };
        let bytes = content.encode_to_vec();
        let digest = sha256_digest(&bytes);
        (bytes, digest)
    }

    fn sign_event(
        signer: &Keypair,
        identity: &str,
        collection: i32,
        sequence: u64,
        identity_sequence: u64,
        vector_clock: Vec<u64>,
        content_digest: ContentDigest,
    ) -> SignedEvent {
        sign_event_raw(
            signer,
            identity,
            collection,
            sequence,
            identity_sequence,
            Some(VectorClock {
                sequence: vector_clock,
            }),
            content_digest,
        )
    }

    fn sign_event_raw(
        signer: &Keypair,
        identity: &str,
        collection: i32,
        sequence: u64,
        identity_sequence: u64,
        vector_clock: Option<VectorClock>,
        content_digest: ContentDigest,
    ) -> SignedEvent {
        let event = Event {
            key: Some(ProtoEventKey {
                collection,
                identity: identity.to_string(),
                signed_by: Some(signer.public.clone()),
                sequence,
            }),
            identity_sequence,
            vector_clock,
            previous_signature: Vec::new(),
            previous_root: Vec::new(),
            content_digest: Some(content_digest),
            created_at: 0,
            application: None,
        };
        let event_bytes = event.encode_to_vec();
        let signature = signer.signing.sign(&event_bytes).to_bytes().to_vec();
        SignedEvent {
            signature,
            event_bytes,
        }
    }

    /// Insert an identity event at `sequence` signed by `signer`, with content
    /// listing `rotation` and `signing` keys. Returns the identity string —
    /// derived from the genesis content if `identity` is None, otherwise the
    /// provided identity is reused (chain extension).
    ///
    /// Builds a valid VC: indexed against the signers content (the prior content
    /// for rotations, the new content itself for genesis), with self entry
    /// equal to `sequence` and other entries equal to each co-signer's
    /// max identity-event sequence already in the directory.
    fn add_identity_event(
        client: &mut PolycentricClient,
        signer: &Keypair,
        identity: Option<&str>,
        sequence: u64,
        rotation: Vec<PublicKey>,
        signing: Vec<PublicKey>,
    ) -> String {
        // Genesis identity strings are derived from SHA256 of the inner
        // Identity message (not the outer Content wrapper digest).
        let provisional_identity = Identity {
            rotation_keys: rotation.clone(),
            signing_keys: signing.clone(),
            revocation_bounds: Vec::new(),
            servers: None,
            recovery_key: None,
            recovery_signature: None,
        };
        let id_string = identity
            .map(|s| s.to_string())
            .unwrap_or_else(|| provisional_identity.derive_hex_key());

        // identity_sequence: 1 for genesis (self-reference); N-1 for rotations.
        let identity_sequence = if sequence == 1 { 1 } else { sequence - 1 };

        // For rotations: compute revocation_bounds — keys present in the
        // prior content but absent from the new content, with their max observed
        // sequence per collection at this point in time.
        //
        // Bounds are treated as cumulative here: the head document must carry
        // every active bound, because `revocation_target_for` only consults the
        // head. So carry the prior document's bounds forward, dropping any whose
        // key the new content re-authorizes, and append the newly-removed keys.
        let revocation_bounds: Vec<RevocationBound> = if sequence == 1 {
            Vec::new()
        } else {
            let prior_chain = client
                .identity_chain(&id_string)
                .expect("prior chain resolves");
            let prior = prior_chain
                .event_at_sequence(sequence - 1)
                .expect("prior identity event must exist for a rotation");
            let new_keys: Vec<&PublicKey> = rotation.iter().chain(signing.iter()).collect();
            let is_reauthorized = |pk: &PublicKey| {
                new_keys
                    .iter()
                    .any(|nk| nk.key_type == pk.key_type && nk.key == pk.key)
            };
            let removed: Vec<&PublicKey> = prior
                .document
                .deduplicated_keys()
                .into_iter()
                .filter(|pk| !is_reauthorized(pk))
                .collect();
            let carried: Vec<RevocationBound> = prior
                .document
                .revocation_bounds
                .iter()
                .filter(|rb| {
                    rb.revoked_key
                        .as_ref()
                        .is_none_or(|pk| !is_reauthorized(pk))
                })
                .cloned()
                .collect();
            carried
                .into_iter()
                .chain(removed.into_iter().map(|pk| {
                    // Per collection: build a target naming the revoked key's
                    // head event (max-sequence) with its root + sequence.
                    let mut heads: HashMap<i32, (u64, &SignedEvent)> = HashMap::new();
                    for (k, signed) in client.event_store.by_identity(&id_string) {
                        if k.signed_by_key_type == pk.key_type && k.signed_by_key == pk.key {
                            heads
                                .entry(k.collection)
                                .and_modify(|(seq, head)| {
                                    if k.sequence >= *seq {
                                        *seq = k.sequence;
                                        *head = signed;
                                    }
                                })
                                .or_insert((k.sequence, signed));
                        }
                    }
                    let targets: Vec<EventProofTarget> = heads
                        .into_iter()
                        .map(|(collection, (_, signed))| {
                            let inner = Event::decode(signed.event_bytes.as_slice())
                                .expect("head event decodes");
                            let leaf_count = client
                                .canonical_signatures(&id_string, collection)
                                .into_iter()
                                .position(|s| s == signed.signature)
                                .map(|p| p as u64)
                                .unwrap_or(0);
                            EventProofTarget {
                                collection,
                                signature: signed.signature.clone(),
                                root: inner.previous_root,
                                leaf_count,
                            }
                        })
                        .collect();
                    RevocationBound {
                        revoked_key: Some(pk.clone()),
                        targets,
                    }
                }))
                .collect()
        };

        // Build the actual content (with computed bounds) and its digest.
        let (content_bytes, digest) =
            identity_content(rotation.clone(), signing.clone(), revocation_bounds.clone());

        // content the VC is indexed against.
        let signer_identity_content = Identity {
            rotation_keys: rotation,
            signing_keys: signing,
            revocation_bounds,
            servers: None,
            recovery_key: None,
            recovery_signature: None,
        };

        let dedup = signer_identity_content.deduplicated_keys();
        let self_pos = dedup
            .iter()
            .position(|pk| pk.key_type == signer.public.key_type && pk.key == signer.public.key)
            .expect("signer must be present in signer_identity_content");
        let mut vc = vec![0u64; dedup.len()];
        vc[self_pos] = sequence;
        if sequence > 1 {
            for (pos, key) in dedup.iter().enumerate() {
                if pos == self_pos {
                    continue;
                }
                vc[pos] = client.get_identity_sequence(&id_string, key).unwrap_or(0);
            }
        }

        client
            .copy_content(&digest, content_bytes)
            .expect("content matches its computed digest");
        let signed = sign_event(
            signer,
            &id_string,
            collections::IDENTITY,
            sequence,
            identity_sequence,
            vc,
            digest,
        );
        client.copy_event(signed).unwrap();
        id_string
    }

    fn dummy_post_digest() -> ContentDigest {
        let bytes = Content {
            content_body: Some(Body::Post(Post::default())),
        }
        .encode_to_vec();
        sha256_digest(&bytes)
    }

    fn assert_invalid_contains(result: Result<(), CoreError>, needle: &str) {
        let err = result.expect_err("expected validation to fail");
        match &err {
            CoreError::InvalidEvent(m) => assert!(
                m.contains(needle),
                "expected substring {:?}, got: {:?}",
                needle,
                m
            ),
            _ => panic!("expected InvalidEvent, got {:?}", err),
        }
    }

    #[test]
    fn copied_bundles_are_locally_readable_with_avatar() {
        use polycentric_common::models::protos_v2::{
            Blob, Content, Image, ImageSet, ProfileUpdate, SerializedContent,
        };

        let a = keypair(1);

        let (identity_bytes, identity_digest) =
            identity_content(vec![a.public.clone()], vec![], Vec::new());
        let identity_str = Identity {
            rotation_keys: vec![a.public.clone()],
            signing_keys: vec![],
            revocation_bounds: Vec::new(),
            servers: None,
            recovery_key: None,
            recovery_signature: None,
        }
        .derive_hex_key();
        let genesis = sign_event(
            &a,
            &identity_str,
            collections::IDENTITY,
            1,
            1,
            vec![1],
            identity_digest,
        );

        let profile_content = Content {
            content_body: Some(Body::ProfileUpdate(ProfileUpdate {
                name: Some("Test".into()),
                avatar: Some(ImageSet {
                    images: vec![Image {
                        blob: Some(Blob {
                            digest: Some(sha256_digest(b"avatar")),
                            mime_type: "image/png".into(),
                            size: 6,
                        }),
                        width: 80,
                        height: 80,
                    }],
                }),
                banner: None,
                description: None,
                alias: None,
            })),
        };
        let profile_bytes = profile_content.encode_to_vec();
        let profile_signed = sign_event(
            &a,
            &identity_str,
            collections::PROFILE,
            1,
            1,
            vec![1],
            sha256_digest(&profile_bytes),
        );

        let identity_bundle = EventBundle {
            signed_event: Some(genesis),
            serialized_content: Some(SerializedContent {
                content_bytes: identity_bytes,
            }),
            event_proofs: Vec::new(),
            meta: None,
        };
        let profile_bundle = EventBundle {
            signed_event: Some(profile_signed),
            serialized_content: Some(SerializedContent {
                content_bytes: profile_bytes,
            }),
            event_proofs: Vec::new(),
            meta: None,
        };

        let mut client = PolycentricClient::new();
        client.copy_bundles(vec![profile_bundle, identity_bundle]);

        let bundles = client
            .list_valid_events(&identity_str, collections::PROFILE)
            .expect("list_valid_events");
        assert_eq!(bundles.len(), 1);

        let content_bytes = &bundles[0]
            .serialized_content
            .as_ref()
            .expect("profile content should be stored")
            .content_bytes;
        let decoded = Content::decode(content_bytes.as_slice()).expect("content decodes");
        let Some(Body::ProfileUpdate(update)) = decoded.content_body else {
            panic!("expected a profile update");
        };
        assert_eq!(update.name.as_deref(), Some("Test"));
        assert!(update.avatar.is_some(), "avatar should survive the copy");
    }

    #[test]
    fn validates_event_signed_by_key_in_content() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);
        // Genesis dedup ordering: [A_rot, B_signing].
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // B signs in collection 2 at seq=1, referencing the genesis content.
        // VC indexed by [A, B]: A has no prior events, B's self entry = 1.
        let event = sign_event(&b, &identity, 2, 1, 1, vec![0, 1], dummy_post_digest());
        client
            .validate_event(&event, &[])
            .expect("event should validate");
    }

    #[test]
    fn rejects_event_signed_by_unlisted_key() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let stranger = keypair(99);
        let identity = add_identity_event(&mut client, &a, None, 1, vec![a.public.clone()], vec![]);

        // Stranger fails at head auth — VC is not reached.
        let event = sign_event(&stranger, &identity, 2, 1, 1, vec![1], dummy_post_digest());
        assert_invalid_contains(client.validate_event(&event, &[]), "not authorized");
    }

    #[test]
    fn rotation_key_can_add_new_rotation_key() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let c = keypair(3);
        let identity = add_identity_event(&mut client, &a, None, 1, vec![a.public.clone()], vec![]);

        // A rotates and adds C as a new rotation key. Dedup at seq=2: [A, C].
        add_identity_event(
            &mut client,
            &a,
            Some(&identity),
            2,
            vec![a.public.clone(), c.public.clone()],
            vec![],
        );

        // Head advances to seq=2; C is in the head content. VC indexed by [A, C].
        let event = sign_event(&c, &identity, 2, 1, 2, vec![0, 1], dummy_post_digest());
        client
            .validate_event(&event, &[])
            .expect("event should validate");
    }

    #[test]
    fn signing_key_cannot_extend_identity_chain() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2); // signing key only — must not be able to rotate
        let c = keypair(3);
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // B (signing only) attempts to extend the chain. Head stays at seq=1.
        add_identity_event(
            &mut client,
            &b,
            Some(&identity),
            2,
            vec![a.public.clone(), c.public.clone()],
            vec![b.public.clone()],
        );

        // C references identity_sequence=2, but the chain didn't extend
        // because B's "rotation" wasn't rotation-authorized. So id_seq=2
        // is outside the validated chain.
        let event = sign_event(&c, &identity, 2, 1, 2, vec![0, 1], dummy_post_digest());
        assert_invalid_contains(
            client.validate_event(&event, &[]),
            "outside the validated chain",
        );

        // A and B are still valid signers under the content at seq=1 = [A, B].
        client
            .validate_event(
                &sign_event(&a, &identity, 2, 1, 1, vec![1, 0], dummy_post_digest()),
                &[],
            )
            .expect("A still signs under content at seq=1");
        client
            .validate_event(
                &sign_event(&b, &identity, 2, 2, 1, vec![0, 2], dummy_post_digest()),
                &[],
            )
            .expect("B still signs under content at seq=1");
    }

    #[test]
    fn signing_key_can_ack_membership_and_publish() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);

        let identity = add_identity_event(&mut client, &a, None, 1, vec![a.public.clone()], vec![]);

        add_identity_event(
            &mut client,
            &a,
            Some(&identity),
            2,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        add_identity_event(
            &mut client,
            &b,
            Some(&identity),
            3,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        let chain = client.identity_chain(&identity).expect("chain resolves");
        assert_eq!(
            chain.latest_event().expect("chain is non-empty").sequence,
            3
        );

        let post = sign_event(&b, &identity, 2, 1, 3, vec![0, 1], dummy_post_digest());
        client
            .validate_event(&post, &[])
            .expect("B's FEED post validates against its own ack at seq=3");
    }

    #[test]
    fn finds_event_by_sequence_and_signer_prefix() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);

        let identity = add_identity_event(&mut client, &a, None, 1, vec![a.public.clone()], vec![]);
        add_identity_event(
            &mut client,
            &a,
            Some(&identity),
            2,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );
        add_identity_event(
            &mut client,
            &b,
            Some(&identity),
            3,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        let post_a = sign_event(&a, &identity, 2, 1, 3, vec![1, 0], dummy_post_digest());
        let post_b = sign_event(&b, &identity, 2, 1, 3, vec![0, 1], dummy_post_digest());
        client.copy_event(post_a).expect("copy a");
        client.copy_event(post_b).expect("copy b");

        let signer_of = |bundle: EventBundle| {
            let event = Event::decode(bundle.signed_event.unwrap().event_bytes.as_slice()).unwrap();
            event.key.unwrap().signed_by.unwrap().key
        };

        let prefix_a = hex::encode(&a.public.key[..8]);
        let prefix_b = hex::encode(&b.public.key[..8]);

        let found_a = client
            .find_event_bundle_by_sequence(&identity, 2, 1, Some(&prefix_a))
            .expect("a's post");
        assert_eq!(signer_of(found_a), a.public.key);

        let found_b = client
            .find_event_bundle_by_sequence(&identity, 2, 1, Some(&prefix_b))
            .expect("b's post");
        assert_eq!(signer_of(found_b), b.public.key);

        assert!(
            client
                .find_event_bundle_by_sequence(&identity, 2, 1, None)
                .is_some()
        );
        assert!(
            client
                .find_event_bundle_by_sequence(&identity, 2, 1, Some("ffff"))
                .is_none()
        );
    }

    #[test]
    fn revoked_key_cannot_sign_against_new_identity_content() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // A rotates and drops B. Head is now at seq=2 with content=[A].
        add_identity_event(
            &mut client,
            &a,
            Some(&identity),
            2,
            vec![a.public.clone()],
            vec![],
        );

        // B claims identity_sequence=2 (the post-revocation content, which omits
        // B). Rejected because B isn't authorized by that content.
        assert_invalid_contains(
            client.validate_event(
                &sign_event(&b, &identity, 2, 1, 2, vec![1], dummy_post_digest()),
                &[],
            ),
            "not authorized",
        );

        // A is still valid under the new content at seq=2.
        client
            .validate_event(
                &sign_event(&a, &identity, 2, 1, 2, vec![1], dummy_post_digest()),
                &[],
            )
            .expect("A still signs under content at seq=2");
    }

    #[test]
    fn revoked_key_prior_events_remain_valid() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // B writes an event under the genesis content and propagates it; A
        // observes it (we model this by inserting into the shared store
        // before the rotation).
        let b_prior = sign_event(&b, &identity, 2, 1, 1, vec![0, 1], dummy_post_digest());
        client
            .validate_event(&b_prior, &[])
            .expect("B's event is valid under genesis");
        client
            .copy_event(b_prior.clone())
            .expect("B's prior event inserts");

        // A now rotates and removes B. The rotation event captures the
        // rotator's bound for B in collection 2 = 1 (B's latest observed
        // event at the time A wrote the rotation).
        add_identity_event(
            &mut client,
            &a,
            Some(&identity),
            2,
            vec![a.public.clone()],
            vec![],
        );

        // B's prior event references the genesis content (where B was authorized),
        // and its sequence (1) is within the rotator's recorded bound for B
        // in collection 2. So it remains valid after revocation.
        client
            .validate_event(&b_prior, &[])
            .expect("B's prior event remains valid after revocation");
    }

    #[test]
    fn revoked_key_cannot_forge_new_prior_claiming_event() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // Before rotation: B legitimately writes one event in collection 2.
        let b_legit = sign_event(&b, &identity, 2, 1, 1, vec![0, 1], dummy_post_digest());
        client
            .copy_event(b_legit)
            .expect("legitimate prior event inserts");

        // A rotates and revokes B. The rotation event records B's bound in
        // collection 2 as 1 (B's max observed sequence at that time).
        add_identity_event(
            &mut client,
            &a,
            Some(&identity),
            2,
            vec![a.public.clone()],
            vec![],
        );

        // B forges a new event at seq=2 — off the chain ending at the
        // recorded head, so it's rejected.
        let b_forgery = sign_event(&b, &identity, 2, 2, 1, vec![0, 2], dummy_post_digest());
        let err = client
            .validate_event(&b_forgery, &[])
            .expect_err("forgery must be rejected");
        match &err {
            CoreError::InvalidEvent(m) => {
                assert!(
                    m.contains("post-revocation forgery"),
                    "expected post-revocation forgery error, got: {}",
                    m
                );
                assert!(m.contains("target for collection"));
            }
            _ => panic!("expected InvalidEvent, got {:?}", err),
        }
    }

    #[test]
    fn rejects_event_missing_vector_clock() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let identity = add_identity_event(&mut client, &a, None, 1, vec![a.public.clone()], vec![]);

        let event = sign_event_raw(&a, &identity, 2, 1, 1, None, dummy_post_digest());
        assert_invalid_contains(client.validate_event(&event, &[]), "missing vector_clock");
    }

    #[test]
    fn rejects_event_with_wrong_vc_length() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // content has 2 keys but VC has 3 entries.
        let event = sign_event(&b, &identity, 2, 1, 1, vec![0, 1, 0], dummy_post_digest());
        assert_invalid_contains(client.validate_event(&event, &[]), "vector_clock has 3");
    }

    #[test]
    fn rejects_event_with_wrong_self_position_value() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // B's event is at sequence=1 but VC[self=1] claims 5 — inconsistent.
        let event = sign_event(&b, &identity, 2, 1, 1, vec![0, 5], dummy_post_digest());
        assert_invalid_contains(client.validate_event(&event, &[]), "self entry");
    }

    #[test]
    fn keeps_content_event_referencing_unsynced_event() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // B's event references A at seq=7 in collection 2, which we haven't
        // synced. The event is still valid — the gap is ours to fetch.
        let event = sign_event(&b, &identity, 2, 1, 1, vec![7, 1], dummy_post_digest());
        client
            .validate_event(&event, &[])
            .expect("content event with an unsynced referenced event should validate");
    }

    #[test]
    fn validates_event_when_referenced_event_present() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let b = keypair(2);
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            vec![a.public.clone()],
            vec![b.public.clone()],
        );

        // A writes an event at seq=1 in collection 2 (no prior B observations).
        let a_event = sign_event(&a, &identity, 2, 1, 1, vec![1, 0], dummy_post_digest());
        client.copy_event(a_event).expect("a's event should insert");

        // B now writes an event referencing A's seq=1 — prerequisite present.
        let b_event = sign_event(&b, &identity, 2, 1, 1, vec![1, 1], dummy_post_digest());
        client
            .validate_event(&b_event, &[])
            .expect("event with satisfied causal prerequisite should validate");
    }

    #[test]
    fn builds_vector_clock_for_new_identity_event() {
        let mut client = PolycentricClient::new();
        let a = keypair(1);

        let identity_content = Identity {
            rotation_keys: vec![a.public.clone()],
            signing_keys: vec![],
            revocation_bounds: vec![],
            servers: None,
            recovery_key: None,
            recovery_signature: None,
        };
        let identity = add_identity_event(
            &mut client,
            &a,
            None,
            1,
            identity_content.rotation_keys.clone(),
            identity_content.signing_keys.clone(),
        );

        let vc = client.build_vector_clock(
            &identity,
            collections::IDENTITY,
            2,
            &a.public,
            2,
            Some(identity_content),
        );

        assert!(
            vc.is_ok(),
            "building a VC for an identity event that references its own sequence should succeed, got {:?}",
            vc.err()
        );
    }

    #[test]
    fn copy_content_stores_matching_content() {
        let mut client = PolycentricClient::default();
        let bytes = b"hello content".to_vec();
        let digest = sha256_digest(&bytes);

        client
            .copy_content(&digest, bytes.clone())
            .expect("content matching its digest is accepted");

        let stored = client.find_content_from_digest(&digest);
        assert_eq!(stored.map(|c| c.content_bytes), Some(bytes));
    }

    #[test]
    fn copy_content_rejects_mismatched_content() {
        let mut client = PolycentricClient::default();
        // Digest is computed over different bytes than we try to insert.
        let digest = sha256_digest(b"the real content");
        let tampered = b"tampered content".to_vec();

        assert!(
            client.copy_content(&digest, tampered).is_err(),
            "content that does not hash to its digest must be rejected"
        );
        // Rejected content is never stored.
        assert!(client.find_content_from_digest(&digest).is_none());
    }

    #[test]
    fn copy_content_rejects_unsupported_digest_type() {
        let mut client = PolycentricClient::default();
        let bytes = b"hello content".to_vec();
        // Correct hash value, but a digest type we can't verify.
        let mut digest = sha256_digest(&bytes);
        digest.r#type = ContentDigestType::Sha256 as i32 + 1;

        assert!(
            client.copy_content(&digest, bytes).is_err(),
            "unsupported digest types must be rejected"
        );
        assert!(client.find_content_from_digest(&digest).is_none());
    }

    #[test]
    fn blocked_identities_follow_block_and_unblock_events() {
        use polycentric_common::models::protos_v2::{Block, Delete, SerializedContent};

        fn graph_bundle(
            signer: &Keypair,
            identity: &str,
            sequence: u64,
            body: Body,
        ) -> EventBundle {
            let content_bytes = Content {
                content_body: Some(body),
            }
            .encode_to_vec();
            let signed_event = sign_event(
                signer,
                identity,
                collections::SOCIAL_GRAPH,
                sequence,
                1,
                vec![sequence],
                sha256_digest(&content_bytes),
            );
            EventBundle {
                signed_event: Some(signed_event),
                serialized_content: Some(SerializedContent { content_bytes }),
                event_proofs: Vec::new(),
                meta: None,
            }
        }

        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let identity = add_identity_event(&mut client, &a, None, 1, vec![a.public.clone()], vec![]);
        client.set_active_identity(Some(identity.clone()));
        assert!(client.blocked_identities().is_empty());

        let block = Block {
            identity: "spammer".to_string(),
        };
        client.copy_bundles(vec![graph_bundle(&a, &identity, 1, Body::Block(block))]);
        assert!(client.is_blocked("spammer"));

        let unblock = Delete {
            event_key: Some(ProtoEventKey {
                collection: collections::SOCIAL_GRAPH,
                identity: identity.clone(),
                signed_by: Some(a.public.clone()),
                sequence: 1,
            }),
        };
        client.copy_bundles(vec![graph_bundle(&a, &identity, 2, Body::Delete(unblock))]);
        assert!(!client.is_blocked("spammer"));
    }

    #[test]
    fn blocked_identities_pick_up_content_copied_after_its_event() {
        use polycentric_common::models::protos_v2::Block;

        let mut client = PolycentricClient::new();
        let a = keypair(1);
        let identity = add_identity_event(&mut client, &a, None, 1, vec![a.public.clone()], vec![]);
        client.set_active_identity(Some(identity.clone()));

        let content_bytes = Content {
            content_body: Some(Body::Block(Block {
                identity: "spammer".to_string(),
            })),
        }
        .encode_to_vec();
        let digest = sha256_digest(&content_bytes);

        client
            .copy_event(sign_event(
                &a,
                &identity,
                collections::SOCIAL_GRAPH,
                1,
                1,
                vec![1],
                digest.clone(),
            ))
            .expect("graph event should insert");
        assert!(!client.is_blocked("spammer"));

        client
            .copy_content(&digest, content_bytes)
            .expect("content should insert");
        assert!(client.is_blocked("spammer"));
    }

    #[test]
    fn blocked_identities_are_empty_without_an_active_identity() {
        let client = PolycentricClient::new();
        assert!(client.blocked_identities().is_empty());
    }
}
