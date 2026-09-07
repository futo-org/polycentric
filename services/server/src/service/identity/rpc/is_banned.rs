//! `is_banned`: returns whether an identity is banned on this server.
//! Requires the caller to be a moderator.

use crate::service::context::ServiceContext;
use crate::service::identity::repository as id_repo;
use crate::service::identity::rpc::common::require_moderator;
use crate::service::proto::{IsBannedRequest, IsBannedResponse};
use tonic::{Request, Status};

pub async fn handle(
    ctx: &ServiceContext,
    request: Request<IsBannedRequest>,
) -> Result<IsBannedResponse, Status> {
    require_moderator(ctx, &request).await?;

    let body = request.into_inner();

    let is_banned =
        id_repo::Query::is_banned(&ctx.ro_db, &body.target_identity)
            .await
            .map_err(|_| Status::internal("internal server error"))?;

    Ok(IsBannedResponse { is_banned })
}
