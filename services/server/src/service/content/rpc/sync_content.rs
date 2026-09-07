//! `sync_content`: not yet implemented. Stubbed to return
//! `Unimplemented`.

use tonic::Status;

use crate::service::content::content_filestore::ContentFilestore;
use crate::service::context::ServiceContext;
use crate::service::proto::{SyncContentRequest, SyncContentResponse};

pub async fn handle(
    _: &ServiceContext,
    _: &ContentFilestore,
    _: SyncContentRequest,
) -> Result<SyncContentResponse, Status> {
    Err(Status::unimplemented("sync_content is not implemented"))
}
