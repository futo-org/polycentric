//! `get_pairing_session`: returns the aggregated state of a pairing session.

use tonic::Status;

use crate::service::context::ServiceContext;
use crate::service::identity::pairing::rpc::common::load_session_state;
use crate::service::proto::{
    GetPairingSessionRequest, GetPairingSessionResponse,
};

pub async fn handle(
    ctx: &ServiceContext,
    req: GetPairingSessionRequest,
) -> Result<GetPairingSessionResponse, Status> {
    let session_state = load_session_state(&ctx.db, &req.digest_sha256).await?;

    Ok(GetPairingSessionResponse {
        session_state: Some(session_state),
    })
}
