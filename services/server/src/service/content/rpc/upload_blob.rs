//! `upload_blob`: persist a blob's metadata row and write its bytes
//! to the filestore. Mutation — does not use the events pipeline.

use sea_orm::TransactionTrait;
use tonic::Status;

use crate::service::content::content_filestore::ContentFilestore;
use crate::service::content::content_helpers::parse_upload_blob_request;
use crate::service::content::content_repository as ContentRepository;
use crate::service::context::ServiceContext;
use crate::service::proto::{UploadBlobRequest, UploadBlobResponse};

pub async fn handle(
    ctx: &ServiceContext,
    filestore: &ContentFilestore,
    req: UploadBlobRequest,
) -> Result<UploadBlobResponse, Status> {
    let (blob, digest, body) = parse_upload_blob_request(req)?;

    let txn = ctx.db.begin().await.map_err(|e| {
        tracing::error!(error = %e, "upload_blob txn begin error");
        Status::internal("internal server error")
    })?;
    ContentRepository::Mutation::save_blob(&txn, &blob)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "upload_blob save_blob error");
            Status::internal("internal server error")
        })?;
    txn.commit().await.map_err(|e| {
        tracing::error!(error = %e, "upload_blob txn commit error");
        Status::internal("internal server error")
    })?;

    filestore.write_blob(&digest, body).await.map_err(|e| {
        tracing::error!(error = %e, "upload_blob filestore error");
        Status::internal("internal server error")
    })?;

    Ok(UploadBlobResponse {})
}
