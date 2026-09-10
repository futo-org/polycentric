//! gRPC `FeedsService` impl. Each method delegates to a dedicated
//! handler module under `feeds/rpc/`.

pub mod common;
pub mod get_attribution_feed;
pub mod get_explore_feed;
pub mod get_following_feed;
pub mod get_identity_feed;
pub mod get_post;
pub mod get_post_thread;
pub mod get_recommended_feed;

use crate::service::auth::authenticated_identity;
use crate::service::context::{RequestContext, ServiceContext};
use crate::service::proto::feeds_service_server::{
    FeedsService, FeedsServiceServer,
};
use crate::service::proto::{
    GetAttributionFeedRequest, GetExploreFeedRequest, GetFeedResponse,
    GetFollowingFeedRequest, GetIdentityFeedRequest, GetPostRequest,
    GetPostResponse, GetPostThreadRequest, GetPostThreadResponse,
};
use std::sync::Arc;
use tonic::{Request, Response, Status};

pub struct FeedsServiceImpl {
    ctx: Arc<ServiceContext>,
}

#[tonic::async_trait]
impl FeedsService for FeedsServiceImpl {
    async fn get_identity_feed(
        &self,
        request: Request<GetIdentityFeedRequest>,
    ) -> Result<Response<GetFeedResponse>, Status> {
        let caller = authenticated_identity(&request);
        let ctx = RequestContext::new(&self.ctx, caller.as_deref());
        Ok(Response::new(
            get_identity_feed::handle(&ctx, request.into_inner()).await?,
        ))
    }

    async fn get_following_feed(
        &self,
        request: Request<GetFollowingFeedRequest>,
    ) -> Result<Response<GetFeedResponse>, Status> {
        let caller = authenticated_identity(&request);
        let ctx = RequestContext::new(&self.ctx, caller.as_deref());
        Ok(Response::new(
            get_following_feed::handle(&ctx, request.into_inner()).await?,
        ))
    }

    async fn get_recommended_feed(
        &self,
        request: Request<GetFollowingFeedRequest>,
    ) -> Result<Response<GetFeedResponse>, Status> {
        let caller = authenticated_identity(&request);
        let ctx = RequestContext::new(&self.ctx, caller.as_deref());
        Ok(Response::new(
            get_recommended_feed::handle(&ctx, request.into_inner()).await?,
        ))
    }

    async fn get_explore_feed(
        &self,
        request: Request<GetExploreFeedRequest>,
    ) -> Result<Response<GetFeedResponse>, Status> {
        let caller = authenticated_identity(&request);
        let ctx = RequestContext::new(&self.ctx, caller.as_deref());
        Ok(Response::new(
            get_explore_feed::handle(&ctx, request.into_inner()).await?,
        ))
    }

    async fn get_post(
        &self,
        request: Request<GetPostRequest>,
    ) -> Result<Response<GetPostResponse>, Status> {
        let caller = authenticated_identity(&request);
        let ctx = RequestContext::new(&self.ctx, caller.as_deref());
        Ok(Response::new(
            get_post::handle(&ctx, request.into_inner()).await?,
        ))
    }

    async fn get_post_thread(
        &self,
        request: Request<GetPostThreadRequest>,
    ) -> Result<Response<GetPostThreadResponse>, Status> {
        let caller = authenticated_identity(&request);
        let ctx = RequestContext::new(&self.ctx, caller.as_deref());
        Ok(Response::new(
            get_post_thread::handle(&ctx, request.into_inner()).await?,
        ))
    }

    async fn get_attribution_feed(
        &self,
        request: Request<GetAttributionFeedRequest>,
    ) -> Result<Response<GetFeedResponse>, Status> {
        let caller = authenticated_identity(&request);
        let ctx = RequestContext::new(&self.ctx, caller.as_deref());
        Ok(Response::new(
            get_attribution_feed::handle(&ctx, request.into_inner()).await?,
        ))
    }
}

pub fn build_feeds_service(
    ctx: Arc<ServiceContext>,
) -> FeedsServiceServer<FeedsServiceImpl> {
    FeedsServiceServer::new(FeedsServiceImpl { ctx })
}
