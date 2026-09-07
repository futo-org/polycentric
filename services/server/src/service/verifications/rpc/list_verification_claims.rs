//! Claims an identity has made (owns) returns relevant
/// VerificationClaim, VerificationTarget and VerificationVerify events
use crate::data::pipeline;
use crate::service::context::ServiceContext;
use crate::service::proto::{
    ListVerificationClaimsRequest, ListVerificationClaimsResponse,
};
use crate::service::verifications::repository::Query as Repository;
use tonic::Status;

use super::common::claim_bundles::{self, FetchedClaims};
use super::common::map_db_err;

struct Params {
    identity: String,
}

pub async fn handle(
    ctx: &ServiceContext,
    req: ListVerificationClaimsRequest,
) -> Result<ListVerificationClaimsResponse, Status> {
    if req.claimed_by_identity.is_empty() {
        return Err(Status::invalid_argument(
            "claimed_by_identity is required",
        ));
    }

    let params = Params {
        identity: req.claimed_by_identity,
    };
    let view = pipeline::create_pipeline(
        ctx,
        &params,
        fetch,
        claim_bundles::hydrate,
        claim_bundles::filter,
        claim_bundles::view,
    )
    .await?;
    Ok(ListVerificationClaimsResponse {
        claim_bundles: view.claim_bundles,
        event_hints: view.event_hints,
    })
}

async fn fetch(
    ctx: &ServiceContext,
    params: &Params,
) -> Result<FetchedClaims, Status> {
    let claims = Repository::list_claim_events_for_identity(
        &ctx.ro_db,
        &params.identity,
    )
    .await
    .map_err(map_db_err)?;
    claim_bundles::fetch_verification_state(ctx, claims).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::verifications::rpc::common::tests::{
        claim_row, ctx, no_rows, target_row, verify_row,
    };
    use sea_orm::{DbBackend, MockDatabase};

    #[tokio::test]
    async fn wraps_each_claim_with_its_targets_and_verifies() {
        let db = MockDatabase::new(DbBackend::Postgres)
            // Claims, targets, verifies, one combined tombstone lookup, then
            // the identity and profile hint queries.
            .append_query_results([vec![claim_row(1, "alice")]])
            .append_query_results([vec![target_row(2, "alice", &["bob"])]])
            .append_query_results([vec![verify_row(3, "bob", "alice")]])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .into_connection();
        let ctx = ctx(db).await;

        let response = handle(
            &ctx,
            ListVerificationClaimsRequest {
                claimed_by_identity: "alice".to_string(),
            },
        )
        .await
        .unwrap();

        assert_eq!(response.claim_bundles.len(), 1);
        let bundle = &response.claim_bundles[0];
        assert_eq!(
            bundle
                .claim
                .as_ref()
                .unwrap()
                .signed_event
                .as_ref()
                .unwrap()
                .event_bytes,
            vec![1]
        );
        assert_eq!(bundle.targets.len(), 1);
        assert_eq!(bundle.verifies.len(), 1);
    }

    #[tokio::test]
    async fn returns_claims_without_verification_state() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![claim_row(1, "alice")]])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .into_connection();
        let ctx = ctx(db).await;

        let response = handle(
            &ctx,
            ListVerificationClaimsRequest {
                claimed_by_identity: "alice".to_string(),
            },
        )
        .await
        .unwrap();

        assert_eq!(response.claim_bundles.len(), 1);
        assert!(response.claim_bundles[0].targets.is_empty());
        assert!(response.claim_bundles[0].verifies.is_empty());
    }

    #[tokio::test]
    async fn rejects_an_empty_identity() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let ctx = ctx(db).await;

        let result = handle(
            &ctx,
            ListVerificationClaimsRequest {
                claimed_by_identity: String::new(),
            },
        )
        .await;
        assert_eq!(result.unwrap_err().code(), tonic::Code::InvalidArgument);
    }
}
