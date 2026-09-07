//! gRPC `ContentService` impl. Each method delegates to a dedicated
//! handler under `content/rpc/`.

use std::sync::Arc;

use tonic::{Request, Response, Status};

use crate::service::content::content_filestore::ContentFilestore;
use crate::service::context::ServiceContext;
use crate::service::proto::content_service_server::{
    ContentService, ContentServiceServer,
};
use crate::service::proto::{
    SyncContentRequest, SyncContentResponse, UploadBlobRequest,
    UploadBlobResponse, UrlInfoRequest, UrlInfoResponse,
};

pub mod sync_content;
pub mod upload_blob;
pub mod url_info;

pub struct ContentServiceImpl {
    ctx: Arc<ServiceContext>,
    filestore: ContentFilestore,
}

#[tonic::async_trait]
impl ContentService for ContentServiceImpl {
    async fn sync_content(
        &self,
        request: Request<SyncContentRequest>,
    ) -> Result<Response<SyncContentResponse>, Status> {
        Ok(Response::new(
            sync_content::handle(
                &self.ctx,
                &self.filestore,
                request.into_inner(),
            )
            .await?,
        ))
    }

    async fn upload_blob(
        &self,
        request: Request<UploadBlobRequest>,
    ) -> Result<Response<UploadBlobResponse>, Status> {
        Ok(Response::new(
            upload_blob::handle(
                &self.ctx,
                &self.filestore,
                request.into_inner(),
            )
            .await?,
        ))
    }

    async fn url_info(
        &self,
        request: Request<UrlInfoRequest>,
    ) -> Result<Response<UrlInfoResponse>, Status> {
        Ok(Response::new(
            url_info::handle(&self.ctx, request.into_inner()).await?,
        ))
    }
}

pub fn build_content_service(
    ctx: Arc<ServiceContext>,
    filestore: ContentFilestore,
) -> ContentServiceServer<ContentServiceImpl> {
    ContentServiceServer::new(ContentServiceImpl { ctx, filestore })
}
