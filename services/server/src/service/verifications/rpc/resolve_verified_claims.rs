//! Reverse lookup: claims whose fields match given values and that a trusted
//! identity has verified, optionally scoped to a schema by digest. Returns
//! each matching claim with its targets and verifies.
use crate::data::hydration::HydrationState;
use crate::data::pipeline;
use crate::service::context::ServiceContext;
use crate::service::events::TargetEventKey;
use crate::service::events::tombstone::HasEventKey;
use crate::service::proto::{
    ResolveVerifiedClaimsRequest, ResolveVerifiedClaimsResponse,
};
use crate::service::verifications::repository::Query as Repository;
use std::collections::HashSet;
use tonic::Status;

use super::common::claim_bundles::{self, FetchedClaims};
use super::common::map_db_err;

struct Params {
    schema_digest: Option<(i32, Vec<u8>)>,
    match_fields: serde_json::Value,
    verified_by: HashSet<String>,
}

pub async fn handle(
    ctx: &ServiceContext,
    req: ResolveVerifiedClaimsRequest,
) -> Result<ResolveVerifiedClaimsResponse, Status> {
    if req.verified_by_identities.is_empty() {
        return Err(Status::invalid_argument(
            "verified_by_identities is required",
        ));
    }
    // An empty match with no scope would return every verified claim; require
    // at least one narrowing dimension.
    let schema_digest = req
        .schema_digest
        .filter(|digest| !digest.value.is_empty())
        .map(|digest| (digest.r#type, digest.value));
    if schema_digest.is_none() && req.fields.is_empty() {
        return Err(Status::invalid_argument(
            "schema_digest or fields is required",
        ));
    }

    // Fields are STRING (the only kind in use), matched by JSONB containment.
    let match_fields = serde_json::Value::Object(
        req.fields
            .into_iter()
            .map(|(key, value)| (key, serde_json::Value::String(value)))
            .collect(),
    );

    let params = Params {
        schema_digest,
        match_fields,
        verified_by: req.verified_by_identities.into_iter().collect(),
    };
    let view = pipeline::create_pipeline(
        ctx,
        &params,
        fetch,
        claim_bundles::hydrate,
        filter,
        claim_bundles::view,
    )
    .await?;
    Ok(ResolveVerifiedClaimsResponse {
        claim_bundles: view.claim_bundles,
        event_hints: view.event_hints,
    })
}

async fn fetch(
    ctx: &ServiceContext,
    params: &Params,
) -> Result<FetchedClaims, Status> {
    let claims = Repository::list_claim_events_by_fields(
        &ctx.ro_db,
        params.schema_digest.clone(),
        params.match_fields.clone(),
        &params.verified_by,
    )
    .await
    .map_err(map_db_err)?;
    claim_bundles::fetch_verification_state(ctx, claims).await
}

/// Drop tombstoned events, then keep only claims still verified by a trusted
/// identity. The trust check MUST run after the tombstone filter: otherwise a
/// revoked (tombstoned) verify would still confer verified status on its claim
/// even though it is stripped from the returned bundle.
async fn filter(
    ctx: &ServiceContext,
    params: &Params,
    fetched: FetchedClaims,
    hydration: &HydrationState,
) -> Result<FetchedClaims, Status> {
    let live = claim_bundles::filter(ctx, params, fetched, hydration).await?;
    Ok(retain_trusted(live, &params.verified_by))
}

/// A claim counts as verified only if one of its (surviving, non-tombstoned)
/// verifies was authored by a trusted identity — the verify event's own
/// author. Keep those claims and drop verification state left orphaned.
fn retain_trusted(
    mut fetched: FetchedClaims,
    verified_by: &HashSet<String>,
) -> FetchedClaims {
    let trusted_claim_keys: HashSet<TargetEventKey> = fetched
        .verifies
        .iter()
        .filter(|verify| verified_by.contains(&verify.event.identity))
        .map(|verify| verify.claim_key.clone())
        .collect();
    fetched
        .claims
        .retain(|claim| trusted_claim_keys.contains(&claim.event_key()));
    let live: HashSet<TargetEventKey> =
        fetched.claims.iter().map(HasEventKey::event_key).collect();
    fetched.targets.retain(|t| live.contains(&t.claim_key));
    fetched.verifies.retain(|v| live.contains(&v.claim_key));
    fetched
}

#[cfg(test)]
mod tests {
    use super::{FetchedClaims, retain_trusted};
    use crate::service::events::TargetEventKey;
    use crate::service::verifications::repository::VerificationEventDto;
    use crate::service::verifications::rpc::common::tests::{
        claim_row, event_row,
    };
    use std::collections::HashSet;

    fn trusted(identities: &[&str]) -> HashSet<String> {
        identities.iter().map(|s| s.to_string()).collect()
    }

    fn verify(
        id: i64,
        verifier: &str,
        claim_key: &TargetEventKey,
    ) -> VerificationEventDto {
        VerificationEventDto {
            event: event_row(id, verifier),
            content: None,
            claim_key: claim_key.clone(),
        }
    }

    #[test]
    fn trusted_verify_keeps_claim() {
        let (claim_event, claim_content) = claim_row(1, "alice");
        let claim_key = TargetEventKey::of(&claim_event);
        let fetched = FetchedClaims {
            claims: vec![(claim_event, Some(claim_content))],
            targets: vec![],
            verifies: vec![verify(10, "futo", &claim_key)],
        };

        let out = retain_trusted(fetched, &trusted(&["futo"]));

        assert_eq!(out.claims.len(), 1);
        assert_eq!(out.verifies.len(), 1);
    }

    #[test]
    fn revoked_trusted_verify_excludes_claim() {
        // Models the state after the tombstone filter has stripped FUTO's
        // revoked verify, leaving only an untrusted one: the claim must no
        // longer resolve as verified, and the orphaned verify is pruned.
        let (claim_event, claim_content) = claim_row(1, "alice");
        let claim_key = TargetEventKey::of(&claim_event);
        let fetched = FetchedClaims {
            claims: vec![(claim_event, Some(claim_content))],
            targets: vec![],
            verifies: vec![verify(11, "mallory", &claim_key)],
        };

        let out = retain_trusted(fetched, &trusted(&["futo"]));

        assert!(out.claims.is_empty());
        assert!(out.verifies.is_empty(), "orphaned verify should be pruned");
    }

    #[test]
    fn claim_with_no_surviving_verify_is_excluded() {
        // The revoked verify was the claim's only verify; nothing survives.
        let (claim_event, claim_content) = claim_row(1, "alice");
        let fetched = FetchedClaims {
            claims: vec![(claim_event, Some(claim_content))],
            targets: vec![],
            verifies: vec![],
        };

        let out = retain_trusted(fetched, &trusted(&["futo"]));

        assert!(out.claims.is_empty());
    }
}
