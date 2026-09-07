use crate::service::events::repository as EventsRepository;
use crate::service::proto::PublicKey;
use crate::service::{
    context::ServiceContext, events::repository::HeadInfoRow,
};

use polycentric_common::models::protos_v2::{
    EventKey, ListHeadsRequest, ListHeadsResponse,
};

use tonic::Status;

pub async fn handle(
    ctx: &ServiceContext,
    req: ListHeadsRequest,
) -> Result<ListHeadsResponse, Status> {
    let rows = EventsRepository::Query::list_heads(&ctx.ro_db, &req.identity)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "list_heads db error");
            Status::internal("internal server error")
        })?;

    let output = rows
        .into_iter()
        .map(|row| row_to_event_key(&req.identity, row))
        .collect::<Vec<_>>();

    Ok(ListHeadsResponse { heads: output })
}

fn row_to_event_key(identity: &str, row: HeadInfoRow) -> EventKey {
    EventKey {
        collection: row.collection as i32,
        identity: identity.to_string(),
        signed_by: Some(PublicKey {
            key_type: row.public_key_type as i32,
            key: row.public_key,
        }),
        sequence: row.max_seq as u64,
    }
}
