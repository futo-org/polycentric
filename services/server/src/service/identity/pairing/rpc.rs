//! gRPC `PairingService` impl. Each method delegates to a handler
//! under `pairing/rpc/`.

pub mod common;
pub mod get_pairing_session;
pub mod join_pairing_session;
pub mod put_pairing_session;

use std::sync::Arc;

use tonic::{Request, Response, Status};

use crate::service::context::ServiceContext;
use crate::service::proto::pairing_service_server::{
    PairingService, PairingServiceServer,
};
use crate::service::proto::{
    GetPairingSessionRequest, GetPairingSessionResponse,
    JoinPairingSessionRequest, JoinPairingSessionResponse,
    PutPairingSessionRequest, PutPairingSessionResponse,
};

pub struct PairingServiceImpl {
    ctx: Arc<ServiceContext>,
}

#[tonic::async_trait]
impl PairingService for PairingServiceImpl {
    async fn put_pairing_session(
        &self,
        request: Request<PutPairingSessionRequest>,
    ) -> Result<Response<PutPairingSessionResponse>, Status> {
        Ok(Response::new(
            put_pairing_session::handle(&self.ctx, request.into_inner())
                .await?,
        ))
    }

    async fn get_pairing_session(
        &self,
        request: Request<GetPairingSessionRequest>,
    ) -> Result<Response<GetPairingSessionResponse>, Status> {
        Ok(Response::new(
            get_pairing_session::handle(&self.ctx, request.into_inner())
                .await?,
        ))
    }

    async fn join_pairing_session(
        &self,
        request: Request<JoinPairingSessionRequest>,
    ) -> Result<Response<JoinPairingSessionResponse>, Status> {
        Ok(Response::new(
            join_pairing_session::handle(&self.ctx, request.into_inner())
                .await?,
        ))
    }
}

/// Creates the gRPC service implementation for pairing sessions.
pub fn build_pairing_service(
    ctx: Arc<ServiceContext>,
) -> PairingServiceServer<PairingServiceImpl> {
    PairingServiceServer::new(PairingServiceImpl { ctx })
}
