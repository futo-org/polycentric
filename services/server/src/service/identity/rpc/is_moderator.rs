//! `is_moderator`: returns whether the calling identity is a moderator on
//! this server. Authenticated by the bearer JWT (the caller is the
//! subject).

use crate::service::auth::authenticated_identity;
use crate::service::context::ServiceContext;
use crate::service::identity::repository as id_repo;
use crate::service::proto::{IsModeratorRequest, IsModeratorResponse};
use tonic::{Request, Status};

pub async fn handle(
    ctx: &ServiceContext,
    request: Request<IsModeratorRequest>,
) -> Result<IsModeratorResponse, Status> {
    let identity = authenticated_identity(&request)
        .ok_or_else(|| Status::unauthenticated("authentication required"))?;

    let is_moderator = id_repo::Query::is_moderator(&ctx.ro_db, &identity)
        .await
        .map_err(|_| Status::internal("internal server error"))?;

    Ok(IsModeratorResponse { is_moderator })
}
