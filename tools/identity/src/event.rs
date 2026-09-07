//! Construction of signed identity events.
//! TODO: We may want to make a generic rust polycentric client that handles storage etc.

use std::collections::HashMap;

use polycentric_common::merkle;
use polycentric_common::models::protos_v2::{
    ContentDigest, Event, EventKey, Identity, PublicKey, SignedEvent, VectorClock,
};
use prost::Message;

use crate::key::KeyPair;

/// Build the vector clock for an event with `content`, signed by `signer` at
/// `sequence`. The self entry is `sequence`; every co-signer entry is that
/// key's highest prior sequence in the collection (`prior_max`).
pub fn vector_clock(
    content: &Identity,
    signer: &PublicKey,
    sequence: u64,
    prior_max: &HashMap<Vec<u8>, u64>,
) -> VectorClock {
    let dedup = content.deduplicated_keys();
    let sequences = dedup
        .iter()
        .map(|key| {
            if key.key_type == signer.key_type && key.key == signer.key {
                sequence
            } else {
                prior_max.get(&key.key).copied().unwrap_or(0)
            }
        })
        .collect();
    VectorClock {
        sequence: sequences,
    }
}

/// RFC-6962 Merkle anchoring over `prior` signed events (the signer's earlier
/// events in this collection): `(previous_signature, previous_root)`.
///
/// Matches `PolycentricClient::previous_signature` / `previous_root`.
pub fn merkle_anchor(prior: &[SignedEvent]) -> (Vec<u8>, Vec<u8>) {
    let signatures = merkle::canonical_signatures(
        prior
            .iter()
            .map(|se| (se.event_bytes.as_slice(), se.signature.as_slice())),
    );
    let root = merkle::merkle_tree_hash(&signatures)
        .map(|h| h.to_vec())
        .unwrap_or_default();
    let previous_signature = signatures.last().cloned().unwrap_or_default();
    (previous_signature, root)
}

/// Parameters for one identity event.
pub struct EventParams<'a> {
    pub signer: &'a KeyPair,
    pub identity: &'a str,
    pub collection: i32,
    pub sequence: u64,
    pub identity_sequence: u64,
    pub vector_clock: VectorClock,
    pub content_digest: ContentDigest,
    pub previous_signature: Vec<u8>,
    pub previous_root: Vec<u8>,
    pub created_at: u64,
}

/// Build, sign, and return a [`SignedEvent`].
pub fn sign(params: EventParams) -> SignedEvent {
    let event = Event {
        key: Some(EventKey {
            collection: params.collection,
            identity: params.identity.to_string(),
            signed_by: Some(params.signer.to_public_key()),
            sequence: params.sequence,
        }),
        identity_sequence: params.identity_sequence,
        vector_clock: Some(params.vector_clock),
        previous_signature: params.previous_signature,
        previous_root: params.previous_root,
        content_digest: Some(params.content_digest),
        created_at: params.created_at,
        application: None,
    };
    let event_bytes = event.encode_to_vec();
    let signature = params.signer.sign(&event_bytes);
    SignedEvent {
        signature,
        event_bytes,
    }
}
