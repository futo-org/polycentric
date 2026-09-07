//! Helpers for fetching identity-related events that hydrate
//! feed/list/thread responses. Split into per-data-source functions
//! so the pipeline's hydrate stage can fan them out in parallel.

use crate::data::EventWithContentRow;
use crate::service::content::content_filestore::ContentFilestore;
use crate::service::context::ServiceContext;
use crate::service::feeds::repository::{self as FeedsRepository};
use crate::service::identity::chain;
use crate::service::identity::repository::{
    Erased, Mutation as IdentityMutation, Query as IdentityRepo,
};
use crate::service::proofs::cache::ProofCache;
use crate::service::proto::{ContentDigest, PublicKey};
use polycentric_common::models::collections;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbErr, RuntimeErr, TransactionTrait,
};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tonic::Status;

const ALL_COLLECTIONS: [i32; 8] = [
    collections::IDENTITY,
    collections::FEED,
    collections::PROFILE,
    collections::INTERACTIONS,
    collections::SOCIAL_GRAPH,
    collections::REPORTS,
    collections::LABELS,
    collections::VERIFICATIONS,
];

/// Events erased per transaction. Keeps each transaction short so a deadlock
/// with the tally cron or a worker only costs one batch.
const ERASE_BATCH: u64 = 50_000;

/// Erases an identity's events, deletes blobs nothing references any more,
/// and drops its cached chain state. Used by bans and the operator command.
pub async fn erase_identity(
    db: &DatabaseConnection,
    filestore: Option<&ContentFilestore>,
    proof_cache: Option<&ProofCache>,
    identity: &str,
) -> Result<Erased, DbErr> {
    let mut total = Erased::default();
    let mut after = 0;
    loop {
        let started = Instant::now();
        let batch = retry_deadlocks(|| async {
            let txn = db.begin().await?;
            let batch = IdentityMutation::erase_events_batch(
                &txn,
                identity,
                after,
                ERASE_BATCH,
            )
            .await?;
            txn.commit().await?;
            Ok(batch)
        })
        .await?;
        let Some(batch) = batch else { break };

        delete_blobs(filestore, &batch.blobs).await;
        total.events += batch.erased.events;
        total.content += batch.erased.content;
        total.blobs += batch.erased.blobs;
        after = batch.last_id;
        tracing::info!(
            identity,
            events = total.events,
            content = total.content,
            blobs = total.blobs,
            batch_ms = started.elapsed().as_millis(),
            "erased batch"
        );
    }
    retry_deadlocks(|| async {
        let txn = db.begin().await?;
        IdentityMutation::erase_derived(&txn, identity).await?;
        txn.commit().await
    })
    .await?;

    if let Some(cache) = proof_cache {
        cache.invalidate_identity(identity).await;
        for collection in ALL_COLLECTIONS {
            cache.invalidate_canonical(identity, collection).await;
        }
    }
    Ok(total)
}

/// Deletes content rows no event references, and their blob bodies.
pub async fn prune_content(
    db: &DatabaseConnection,
    filestore: Option<&ContentFilestore>,
) -> Result<Erased, DbErr> {
    let (content, blobs) = retry_deadlocks(|| async {
        let txn = db.begin().await?;
        let pruned = IdentityMutation::prune_orphan_content(&txn).await?;
        txn.commit().await?;
        Ok(pruned)
    })
    .await?;

    delete_blobs(filestore, &blobs).await;
    Ok(Erased {
        content,
        blobs: blobs.len() as u64,
        ..Erased::default()
    })
}

const DEADLOCK_RETRIES: u32 = 5;

/// Reruns `run` when Postgres aborts it as a deadlock victim. The erase
/// contends with the tally cron and workers, which lock rows in another
/// order.
async fn retry_deadlocks<T, F, Fut>(mut run: F) -> Result<T, DbErr>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, DbErr>>,
{
    let mut attempt = 0;
    loop {
        match run().await {
            Err(err) if attempt < DEADLOCK_RETRIES && is_deadlock(&err) => {
                attempt += 1;
                tracing::warn!(attempt, "deadlock detected, retrying");
                tokio::time::sleep(Duration::from_secs(u64::from(attempt)))
                    .await;
            }
            result => return result,
        }
    }
}

fn is_deadlock(err: &DbErr) -> bool {
    let (DbErr::Exec(RuntimeErr::SqlxError(err))
    | DbErr::Query(RuntimeErr::SqlxError(err))) = err
    else {
        return false;
    };
    err.as_database_error()
        .and_then(|err| err.code())
        .is_some_and(|code| code == "40P01" || code == "40001")
}

async fn delete_blobs(
    filestore: Option<&ContentFilestore>,
    blobs: &[ContentDigest],
) {
    let Some(filestore) = filestore else { return };
    for digest in blobs {
        if let Err(error) = filestore.delete_blob(digest).await {
            tracing::warn!(
                %error,
                digest = hex::encode(&digest.value),
                "failed to delete blob"
            );
        }
    }
}

/// The identity-chain and profile events for `identities`. Fetched
/// sequentially so MockDatabase-backed tests stay deterministic; skips the
/// lookups entirely for an empty list.
pub async fn list_identity_and_profile_events(
    ctx: &ServiceContext,
    identities: Vec<String>,
) -> Result<(Vec<EventWithContentRow>, Vec<EventWithContentRow>), Status> {
    if identities.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }
    let identity_events = list_identity_events(ctx, identities.clone()).await?;
    let profile_events = list_profile_events(ctx, identities).await?;
    Ok((identity_events, profile_events))
}

/// Fetch the latest identity events (rotation/signing key chain) for
/// each identity in `identities`, and warm the proof cache from
/// whichever Identity content payload is freshest per identity.
pub async fn list_identity_events(
    ctx: &ServiceContext,
    identities: Vec<String>,
) -> Result<Vec<EventWithContentRow>, Status> {
    let rows = IdentityRepo::list_identity_events_for_identities(
        &ctx.ro_db, identities,
    )
    .await
    .map_err(map_db_err)?;
    warm_identity_cache(ctx, &rows).await;
    Ok(rows)
}

/// Fetch the latest profile event (display name, avatar, banner)
/// for each identity in `identities`.
pub async fn list_profile_events(
    ctx: &ServiceContext,
    identities: Vec<String>,
) -> Result<Vec<EventWithContentRow>, Status> {
    FeedsRepository::Query::list_latest_profiles_for_identities(
        &ctx.ro_db, identities,
    )
    .await
    .map_err(map_db_err)
}

/// Pass our the identity events through to the proof cache
/// probably a better place for this
///
/// `rows` from `list_identity_events_for_identities` are an identity's
/// complete IDENTITY-collection chain, so each identity's chain is
/// validated in memory (no extra queries) and only the validated head is
/// cached. Caching raw events instead would let a forged, unauthorized
/// IDENTITY event poison the cache and impersonate the identity for
/// everything that reads it (auth, event-write authorization, proofs).
async fn warm_identity_cache(
    ctx: &ServiceContext,
    rows: &[EventWithContentRow],
) {
    let mut by_identity: HashMap<&str, Vec<&EventWithContentRow>> =
        HashMap::new();
    for row in rows {
        by_identity
            .entry(row.0.identity.as_str())
            .or_default()
            .push(row);
    }
    for (identity, identity_rows) in by_identity {
        if let Some(content) =
            chain::validated_chain_head(identity, identity_rows)
        {
            ctx.proof_cache
                .warm_identity_content(identity, content)
                .await;
        }
    }
}

fn map_db_err(e: sea_orm::DbErr) -> Status {
    tracing::error!(error = %e, "identity hints db error");
    Status::internal("internal server error")
}

/// The latest valid identity document for `identity`, via the proof cache.
pub async fn cached_identity_content<C: ConnectionTrait>(
    db: &C,
    proof_cache: &ProofCache,
    identity: &str,
) -> Result<polycentric_common::models::protos_v2::Identity, Status> {
    if let Some(content) = proof_cache.identity_content(identity).await {
        return Ok(content);
    }
    let loaded = IdentityRepo::latest_valid_identity_content(db, identity)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "identity content db error");
            Status::internal("internal server error")
        })?
        .ok_or_else(|| {
            Status::failed_precondition(
                "no identity content for target — sync identity events first",
            )
        })?;
    proof_cache
        .warm_identity_content(identity, loaded.clone())
        .await;
    Ok(loaded)
}

/// Verify that `signer` is permitted to sign an event in
/// `(target_identity, collection)`.
///
/// TODO: share this rule set with `rs-core::client::validate_event`.
pub async fn authorize_event_signer<C: ConnectionTrait>(
    db: &C,
    proof_cache: &ProofCache,
    target_identity: &str,
    signer: &PublicKey,
    collection: i32,
    signature: &[u8],
) -> Result<(), Status> {
    let identity_content =
        cached_identity_content(db, proof_cache, target_identity).await?;

    if identity_content.authorizes_signer(signer) {
        return Ok(());
    }

    let target = identity_content
        .revocation_target_for(signer, collection)
        .ok_or_else(|| {
            Status::permission_denied(
                "signer is revoked or not authorized by target identity",
            )
        })?;

    let canonical =
        proof_cache
        .canonical(db, target_identity, collection)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "authorize_event_signer canonical error");
            Status::internal("internal server error")
        })?;

    let leaf_count = target.leaf_count as usize;
    if canonical.len() < leaf_count
        || !canonical[..leaf_count]
            .iter()
            .any(|s| s.as_slice() == signature)
    {
        return Err(Status::permission_denied(
            "signer revoked and signature is not within the committed bound",
        ));
    }

    Ok(())
}
