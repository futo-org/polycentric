//! Build EventProofs and attach them to outgoing bundles whose signer
//! has been revoked.

use polycentric_common::merkle;
use polycentric_common::models::protos_v2::{
    Event, EventBundle, EventProof, EventProofTarget, PublicKey,
};
use prost::Message;
use tonic::Status;

use crate::service::context::ServiceContext;

/// Build an `EventProof` for `leaf_signature` (in `(identity,
/// collection)`) against a `target`.
pub async fn build_proof_against(
    ctx: &ServiceContext,
    identity: &str,
    collection: i32,
    target: &EventProofTarget,
    leaf_signature: &[u8],
) -> Result<Option<EventProof>, Status> {
    let canonical = ctx
        .proof_cache
        .canonical(&ctx.ro_db, identity, collection)
        .await
        .map_err(db_err)?;

    let leaf_count = target.leaf_count as usize;
    if leaf_count > canonical.len() {
        // Server is missing leaves the target committed to.
        return Ok(None);
    }
    let leaves: Vec<Vec<u8>> = canonical[..leaf_count].to_vec();

    let Some(leaf_index) = leaves.iter().position(|s| s == leaf_signature)
    else {
        return Ok(None);
    };

    match merkle::merkle_tree_hash(&leaves) {
        Some(root)
            if target.root.len() == 32
                && root.as_slice() == target.root.as_slice() => {}
        _ => return Ok(None),
    }

    let audit_path = merkle::build_audit_path(&leaves, leaf_index as u64)
        .map(|p| p.into_iter().map(|h| h.to_vec()).collect::<Vec<Vec<u8>>>())
        .unwrap_or_default();

    Ok(Some(EventProof {
        target_signature: target.signature.clone(),
        leaf_index: leaf_index as u64,
        audit_path,
    }))
}

/// Find the rotator's recorded target for `(signer, collection)` in the
/// latest cached identity content and build a proof against it. Requires
/// the cache to have been warmed (e.g. via `build_identity_hints`).
pub async fn build_revocation_proof(
    ctx: &ServiceContext,
    identity: &str,
    collection: i32,
    signer: &PublicKey,
    leaf_signature: &[u8],
) -> Result<Option<EventProof>, Status> {
    let Some(content) = ctx.proof_cache.identity_content(identity).await else {
        return Ok(None);
    };
    let Some(target) = content.revocation_target_for(signer, collection) else {
        return Ok(None);
    };
    let target = target.clone();
    build_proof_against(ctx, identity, collection, &target, leaf_signature)
        .await
}

/// Add a revocation `EventProof` to each bundle whose signer is recorded
/// as revoked in the latest identity content for that identity.
pub async fn attach_proofs<'a, II, I>(
    ctx: &ServiceContext,
    bundles: II,
) -> Result<(), Status>
where
    II: IntoIterator<Item = &'a mut EventBundle, IntoIter = I>,
    I: Iterator<Item = &'a mut EventBundle> + 'a,
{
    for bundle in bundles {
        let Some(signed) = bundle.signed_event.as_ref() else {
            continue;
        };
        let Ok(inner) = Event::decode(signed.event_bytes.as_slice()) else {
            continue;
        };
        let Some(key) = inner.key.as_ref() else {
            continue;
        };
        let Some(signer) = key.signed_by.as_ref() else {
            continue;
        };

        if let Some(proof) = build_revocation_proof(
            ctx,
            &key.identity,
            key.collection,
            signer,
            &signed.signature,
        )
        .await?
        {
            bundle.event_proofs.push(proof);
        }
    }
    Ok(())
}

fn db_err(e: sea_orm::DbErr) -> Status {
    tracing::error!(error = %e, "proofs db error");
    Status::internal("internal server error")
}
