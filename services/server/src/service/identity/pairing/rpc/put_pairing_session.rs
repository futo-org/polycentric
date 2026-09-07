//! `put_pairing_session`: creates or updates a pairing session.

use crate::service::context::ServiceContext;
use crate::service::identity::pairing::repository as pair_repo;
use crate::service::identity::pairing::rpc::common::load_session_state;
use crate::service::identity::repository as id_repo;
use crate::service::proto as Proto;
use crate::service::proto::{
    PutPairingSessionRequest, PutPairingSessionResponse,
};
use ::entity::pairing_session_model as PairingSessionModel;
use chrono::{DateTime, TimeDelta, Utc};
use polycentric_common::error::CoreError;
use sea_orm::entity::prelude::DateTimeUtc;
use sea_orm::{
    ActiveValue::Set, DatabaseConnection, DatabaseTransaction, TransactionTrait,
};
use sha2::{Digest, Sha256};
use tonic::Status;

/// How far an issuer's timestamp may drift from the server's clock.
const MAX_INITIAL_TIMESTAMP_SKEW: TimeDelta = TimeDelta::minutes(1);

/// Content extracted from the put request after verifying the signature
/// and decoding the payload bytes.
struct Input {
    issuer_identity: String,
    digest_sha256: Vec<u8>,
    issuer_state_bytes: Vec<u8>,
    issuer_signer: Proto::PublicKey,
    issuer_state_signature: Vec<u8>,
    initial_timestamp: DateTimeUtc,
    sequence: i64,
}

pub async fn handle(
    ctx: &ServiceContext,
    req: PutPairingSessionRequest,
) -> Result<PutPairingSessionResponse, Status> {
    // Ensure the request is legitimate and extract content
    let input = extract_and_validate_input(req)?;
    verify_authorization(&ctx.db, &input).await?;

    // Use a transaction to prevent TOCTOU problems
    let txn = ctx.db.begin().await.map_err(|e| {
        tracing::error!(error = %e, "put_pairing_session txn begin error");
        Status::internal("internal server error")
    })?;

    // Get the existing session info so we know what updates we need to make
    let existing = pair_repo::Query::get_latest_pairing_session(
        &txn,
        &input.issuer_identity,
    )
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "put_pairing_session lookup db error");
        Status::internal("internal server error")
    })?;

    let is_new_session = existing
        .as_ref()
        .is_none_or(|stored| stored.digest_sha256 != input.digest_sha256);

    if is_new_session {
        verify_initial_timestamp(&input)?;
    }

    // Perform update if needed
    let response_digest = match existing {
        Some(stored) if is_stale(&input, &stored) => stored.digest_sha256,
        _ => update_session(&txn, input, is_new_session).await?,
    };

    txn.commit().await.map_err(|e| {
        tracing::error!(error = %e, "put_pairing_session txn commit error");
        Status::internal("internal server error")
    })?;

    // Return latest session state to client
    Ok(PutPairingSessionResponse {
        session_state: Some(
            load_session_state(&ctx.db, &response_digest).await?,
        ),
    })
}

/// Validates the request's signature and extracts the input fields that we need.
/// Does not check if the signer is authorized to make this request.
fn extract_and_validate_input(
    req: PutPairingSessionRequest,
) -> Result<Input, Status> {
    let signed = req
        .issuer_state
        .ok_or_else(|| Status::invalid_argument("issuer_state is required"))?;

    let (issuer_signer, digest, issuer_state) =
        signed.open().map_err(|e| match e {
            CoreError::SignatureError(_) => {
                Status::unauthenticated("invalid signature")
            }
            _ => Status::invalid_argument("invalid issuer state"),
        })?;

    let digest_sha256 = Sha256::digest(&issuer_state.session_digest).to_vec();
    let initial_timestamp = DateTime::from_timestamp_millis(
        digest.initial_timestamp,
    )
    .ok_or_else(|| Status::invalid_argument("invalid initial_timestamp"))?;

    Ok(Input {
        issuer_identity: digest.issuer_identity,
        digest_sha256,
        issuer_state_bytes: signed.state_bytes,
        issuer_signer,
        issuer_state_signature: signed.signature,
        initial_timestamp,
        sequence: issuer_state.sequence,
    })
}

/// Checks that the signer is authorized to rotate the identity.
async fn verify_authorization(
    db: &DatabaseConnection,
    input: &Input,
) -> Result<(), Status> {
    let is_authorized = id_repo::Query::is_rotation_key(
        db,
        &input.issuer_identity,
        &input.issuer_signer.key,
    )
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "put_pairing_session authorization db error");
        Status::internal("internal server error")
    })?;

    if !is_authorized {
        return Err(Status::permission_denied(
            "not authorized for identity rotation",
        ));
    }

    Ok(())
}

/// Ensures that a new session's timestamp isn't too far out of sync with the
/// server.
/// Since we reject stale requests, we need to ensure a bad client doesn't
/// lock out future requests by creating a pairing session with a timestamp
/// far into the future.
fn verify_initial_timestamp(input: &Input) -> Result<(), Status> {
    let time_diff = Utc::now()
        .signed_duration_since(input.initial_timestamp)
        .abs();

    if time_diff > MAX_INITIAL_TIMESTAMP_SKEW {
        return Err(Status::invalid_argument(
            "session timestamp outside acceptable skew window",
        ));
    }

    Ok(())
}

/// Signals when input is not newer than the currently-stored state.
///
/// We need this for a couple reasons:
/// 1. There is no reason that we would want to perform an update with state
///    that isn't newer than what we already have.
/// 2. The pairing session is a shared mutable state and the only authorization
///    required to modify it is the signed message that we allow clients to
///    read. Requiring fresh data in any update that we apply prevents
///    "replay attacks" from clients.
fn is_stale(input: &Input, existing: &PairingSessionModel::Model) -> bool {
    if existing.digest_sha256 == input.digest_sha256 {
        input.sequence <= existing.sequence
    } else {
        input.initial_timestamp <= existing.initial_timestamp
    }
}

/// Update the database state to reflect the new input.
/// Returns the SHA256 hash of the digest we are storing after this update.
async fn update_session(
    txn: &DatabaseTransaction,
    input: Input,
    is_new_session: bool,
) -> Result<Vec<u8>, Status> {
    if is_new_session {
        pair_repo::Query::clear_claimers(txn, &input.issuer_identity)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "put_pairing_session clear claimers db error");
                Status::internal("internal server error")
            })?;
    }

    let digest_sha256 = input.digest_sha256.clone();
    let row = PairingSessionModel::ActiveModel {
        issuer_identity: Set(input.issuer_identity),
        digest_sha256: Set(input.digest_sha256),
        issuer_state_bytes: Set(input.issuer_state_bytes),
        issuer_state_signature: Set(input.issuer_state_signature),
        initial_timestamp: Set(input.initial_timestamp),
        sequence: Set(input.sequence),
    };

    pair_repo::Query::put_issuer_state(txn, row)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "put_pairing_session write db error");
            Status::internal("internal server error")
        })?;

    Ok(digest_sha256)
}
