//! VerificationVerify events for a claim: who has verified it.

use crate::data::EventWithContentRow;
use crate::data::pipeline;
use crate::service::context::ServiceContext;
use crate::service::events::TargetEventKey;
use crate::service::proto::{
    ListVerificationVerifiesRequest, ListVerificationVerifiesResponse,
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
    req: ListVerificationVerifiesRequest,
) -> Result<ListVerificationVerifiesResponse, Status> {
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
    Ok(ListVerificationVerifiesResponse {
        event_bundles: view.event_bundles,
        event_hints: view.event_hints,
    })
}

async fn fetch(
    ctx: &ServiceContext,
    params: &Params,
) -> Result<Vec<EventWithContentRow>, Status> {
    Ok(Repository::list_verify_events_for_claims(
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
        claim_event_key, ctx, no_rows, verify_row,
    };
    use sea_orm::{DbBackend, MockDatabase};

    #[tokio::test]
    async fn returns_verify_bundles() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                verify_row(2, "bob", "alice"),
                verify_row(1, "carol", "alice"),
            ]])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .append_query_results([no_rows()])
            .into_connection();
        let ctx = ctx(db).await;

        let response = handle(
            &ctx,
            ListVerificationVerifiesRequest {
                claim_event_key: Some(claim_event_key("alice")),
            },
        )
        .await
        .unwrap();

        assert_eq!(response.event_bundles.len(), 2);
    }

    #[tokio::test]
    async fn rejects_a_missing_claim_key() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let ctx = ctx(db).await;

        let result = handle(
            &ctx,
            ListVerificationVerifiesRequest {
                claim_event_key: None,
            },
        )
        .await;
        assert_eq!(result.unwrap_err().code(), tonic::Code::InvalidArgument);
    }
}
