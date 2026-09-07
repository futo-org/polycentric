//! VerificationTarget events for a claim: who has been asked to verify.

use crate::data::EventWithContentRow;
use crate::data::pipeline;
use crate::service::context::ServiceContext;
use crate::service::events::TargetEventKey;
use crate::service::proto::{
    ListVerificationTargetsRequest, ListVerificationTargetsResponse,
};
use crate::service::verifications::repository::{
    Query as Repository, VerificationEventDto,
};
use tonic::Status;

use super::common::{self, event_list};

struct Params {
    claim_key: TargetEventKey,
}

pub async fn handle(
    ctx: &ServiceContext,
    req: ListVerificationTargetsRequest,
) -> Result<ListVerificationTargetsResponse, Status> {
    let params = Params {
        claim_key: TargetEventKey::from_request(
            req.claim_event_key,
            "claim_event_key",
        )?,
    };
    let view = pipeline::create_pipeline(
        ctx,
        &params,
        fetch,
        event_list::hydrate,
        event_list::filter,
        event_list::view,
    )
    .await?;
    Ok(ListVerificationTargetsResponse {
        event_bundles: view.event_bundles,
        event_hints: view.event_hints,
    })
}

async fn fetch(
    ctx: &ServiceContext,
    params: &Params,
) -> Result<Vec<EventWithContentRow>, Status> {
    Ok(Repository::list_target_events_for_claims(
        &ctx.ro_db,
        std::slice::from_ref(&params.claim_key),
    )
    .await
    .map_err(common::map_db_err)?
    .into_iter()
    .map(VerificationEventDto::into_row)
    .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::verifications::rpc::common::tests::{
        claim_event_key, ctx, no_rows, target_row,
    };
    use sea_orm::{DbBackend, MockDatabase};

    #[tokio::test]
    async fn returns_target_bundles_newest_first() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                target_row(2, "alice", &["bob"]),
                target_row(1, "alice", &["carol"]),
            ]])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .into_connection();
        let ctx = ctx(db).await;

        let response = handle(
            &ctx,
            ListVerificationTargetsRequest {
                claim_event_key: Some(claim_event_key("alice")),
            },
        )
        .await
        .unwrap();

        assert_eq!(response.event_bundles.len(), 2);
        assert_eq!(
            response.event_bundles[0]
                .signed_event
                .as_ref()
                .unwrap()
                .event_bytes,
            vec![2]
        );
    }

    #[tokio::test]
    async fn rejects_a_missing_claim_key() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let ctx = ctx(db).await;

        let result = handle(
            &ctx,
            ListVerificationTargetsRequest {
                claim_event_key: None,
            },
        )
        .await;
        assert_eq!(result.unwrap_err().code(), tonic::Code::InvalidArgument);
    }

    #[tokio::test]
    async fn rejects_a_claim_key_without_a_signer() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let ctx = ctx(db).await;

        let mut key = claim_event_key("alice");
        key.signed_by = None;
        let result = handle(
            &ctx,
            ListVerificationTargetsRequest {
                claim_event_key: Some(key),
            },
        )
        .await;
        assert_eq!(result.unwrap_err().code(), tonic::Code::InvalidArgument);
    }
}
