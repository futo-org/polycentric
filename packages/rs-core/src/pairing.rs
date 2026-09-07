//! Helper functions for identity pairing APIs

use polycentric_common::error::CoreError as CommonError;
use polycentric_common::models::protos_v2::{
    Content, GetPairingSessionRequest, IssuerPairingState, PairingSessionDigest,
    PairingSessionState, PublicKey, content::ContentBody,
    pairing_service_client::PairingServiceClient,
};
use polycentric_common::models::protos_v2::{
    JoinPairingSessionRequest, PutPairingSessionRequest, SignedIssuerState,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Mutex;

use crate::api::CoreError;
use crate::client::PolycentricClient;
use crate::lock::LockRecover;
use crate::time;

// ---------- Validation Logic ----------

/// Fields extracted from a server's `PairingSessionState` message after
/// validation.
/// See other docs for where fields originate from and whether they can be
/// trusted.
pub struct SessionState {
    pub raw: PairingSessionState,
    pub digest: PairingSessionDigest,
    pub issuer_state: IssuerPairingState,
}

#[derive(Default)]
pub struct OpenOptions {
    /// The current time to use for expiration logic.
    /// Leave as `None` to let the validator derive the current time.
    pub now_millis: Option<i64>,

    /// When provided, this value is recorded as an observed sequence for this
    /// pairing session.
    /// It will also be used for checking for rollbacks.
    /// This is useful when pushing a new issuer state and expecting that we
    /// observe it.
    pub min_sequence: Option<i64>,
}

/// Validate the pairing session state and extract its data.
/// The digest is always verified against its expected hash.
/// The signature is always checked against the digest's signer.
/// We also reject expired sessions and outdated states.
/// The validation logic can be tuned with `opts`.
pub fn open_state(
    state: PairingSessionState,
    client: &Mutex<PolycentricClient>,
    digest_sha256: &[u8],
    opts: Option<OpenOptions>,
) -> Result<SessionState, CoreError> {
    // Get concrete values for validation options
    let opts = opts.unwrap_or_default();
    let now_millis = opts.now_millis.unwrap_or_else(|| time::now_millis() as i64);
    let min_sequence = opts.min_sequence;

    // Extract issuer state
    let issuer_msg = state
        .issuer_state
        .as_ref()
        .ok_or_else(|| CoreError::InvalidInput("pairing session has no issuer state".to_owned()))?;

    let (_signer, digest, issuer_state) = issuer_msg.open().map_err(|e| match e {
        CommonError::SignatureError(_) => {
            CoreError::InvalidInput("pairing session issuer state signature is invalid".to_owned())
        }
        other => CoreError::Decode(format!("Failed to decode issuer pairing state: {other}")),
    })?;

    // Validate digest
    let derived_sha256 = Sha256::digest(&issuer_state.session_digest);
    if digest_sha256 != derived_sha256.as_slice() {
        return Err(CoreError::InvalidInput(
            "pairing session digest does not match the requested session".to_owned(),
        ));
    }

    // Get what we need from the polycentric client
    let accept_sequence = {
        let mut client = client.lock_recover();

        if let Some(min_sequence) = min_sequence {
            client.accept_pairing_sequence(digest_sha256, min_sequence);
        }

        let seq = issuer_state.sequence;
        client.try_pairing_sequence(digest_sha256, seq)
    };

    // Validate sequence
    if !accept_sequence {
        return Err(CoreError::InvalidInput(
            "pairing session state sequence is stale".to_owned(),
        ));
    }

    // Validate liveness
    let expires_at_millis = digest
        .initial_timestamp
        .checked_add(digest.ttl_millis)
        .ok_or_else(|| {
            CoreError::InvalidInput("pairing session expiration overflows".to_owned())
        })?;

    if now_millis > expires_at_millis {
        return Err(CoreError::InvalidInput(
            "pairing session has expired".to_owned(),
        ));
    }

    // Return validated output
    Ok(SessionState {
        raw: state,
        digest,
        issuer_state,
    })
}

// ---------- Other Helpers ----------

/// Check if an issuer state authorizes our key.
pub fn does_issuer_authorize(state: &IssuerPairingState, key: &PublicKey) -> bool {
    state
        .identity_state
        .as_ref()
        .and_then(|state| state.serialized_content.as_ref())
        .map(|serialized_content| &serialized_content.content_bytes)
        .and_then(|bytes| Content::decode(bytes.as_slice()).ok())
        .and_then(|content| match content.content_body {
            Some(ContentBody::Identity(document)) => Some(document),
            _ => None,
        })
        .map(|document| document.authorizes_signer(key))
        .unwrap_or(false)
}

// ---------- RPC Wrappers ----------

/// Bare wrapper for a `get_pairing_session` RPC.
/// Does not do any validation of the request or response.
pub async fn fetch_session(
    server_url: &str,
    digest_sha256: Vec<u8>,
) -> Result<PairingSessionState, CoreError> {
    let channel = crate::query::channel(server_url)
        .await
        .map_err(CoreError::Network)?;

    let response = PairingServiceClient::new(channel)
        .get_pairing_session(GetPairingSessionRequest { digest_sha256 })
        .await
        .map_err(|e| CoreError::Network(format!("get_pairing_session: {e}")))?;

    response
        .into_inner()
        .session_state
        .ok_or_else(|| CoreError::Network("get_pairing_session: missing session state".into()))
}

/// Create or update a pairing session's state on the server.
pub async fn put(
    client: &Mutex<PolycentricClient>,
    server_url: &str,
    signed_issuer_state: Vec<u8>,
) -> Result<Vec<u8>, CoreError> {
    // Extract what we need from the caller's request
    let signed = SignedIssuerState::decode(signed_issuer_state.as_slice())
        .map_err(|e| CoreError::Decode(format!("Failed to decode SignedIssuerState: {e}")))?;

    let issuer_state = IssuerPairingState::decode(signed.state_bytes.as_slice())
        .map_err(|e| CoreError::Decode(format!("Failed to decode IssuerPairingState: {e}")))?;

    let digest_sha256 = Sha256::digest(&issuer_state.session_digest);

    // Send out the request
    let channel = crate::query::channel(server_url)
        .await
        .map_err(CoreError::Network)?;

    let mut rpc_client = PairingServiceClient::new(channel);

    let response = rpc_client
        .put_pairing_session(PutPairingSessionRequest {
            issuer_state: Some(signed),
        })
        .await
        .map_err(|e| CoreError::Network(format!("put_pairing_session: {e}")))?;

    // Check that the response is what we want
    let response_state = response
        .into_inner()
        .session_state
        .ok_or_else(|| CoreError::Network("put_pairing_session: missing session state".into()))?;

    // It's possible for the server to mess with the state or for our session
    // to have been superseded by a newer one.
    // Let's make sure we got a valid response that matches what we sent.
    let state = open_state(
        response_state,
        client,
        &digest_sha256,
        Some(OpenOptions {
            min_sequence: Some(issuer_state.sequence),
            ..OpenOptions::default()
        }),
    )?;

    Ok(state.raw.encode_to_vec())
}

pub async fn join(
    client: &Mutex<PolycentricClient>,
    server_url: String,
    digest_sha256: Vec<u8>,
    claimer_key: PublicKey,
) -> Result<(), CoreError> {
    let channel = crate::query::channel(&server_url)
        .await
        .map_err(CoreError::Network)?;

    let mut rpc_client = PairingServiceClient::new(channel);

    let response = rpc_client
        .join_pairing_session(JoinPairingSessionRequest {
            digest_sha256: digest_sha256.clone(),
            claimer_key: Some(claimer_key.clone()),
        })
        .await
        .map_err(|e| CoreError::Network(format!("join_pairing_session: {e}")))?;

    let session_state = response
        .into_inner()
        .session_state
        .ok_or_else(|| CoreError::Network("join_pairing_session: missing session state".into()))?;

    let state = open_state(session_state, client, &digest_sha256, None)?;
    if !state.raw.claimers.contains(&claimer_key) {
        return Err(CoreError::InvalidInput(
            "claimer key is not registered on the pairing session".to_owned(),
        ));
    }

    Ok(())
}
