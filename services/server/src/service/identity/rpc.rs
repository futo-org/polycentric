//! gRPC `IdentityService` impl. Each method delegates to a handler
//! under `identity/rpc/`.
//!
//! These moderation endpoints are gated on the caller's authenticated
//! identity (populated by `auth_middleware` from the bearer JWT and read
//! from the request extensions): the ban endpoints require a moderator.

pub mod common;
pub mod is_banned;
pub mod is_moderator;
pub mod list_bans;
pub mod set_ban_status;

use crate::service::context::ServiceContext;
use crate::service::proto::identity_service_server::{
    IdentityService, IdentityServiceServer,
};
use crate::service::proto::{
    IsBannedRequest, IsBannedResponse, IsModeratorRequest, IsModeratorResponse,
    ListBansRequest, ListBansResponse, SetBanStatusRequest,
    SetBanStatusResponse,
};
use std::sync::Arc;
use tonic::{Request, Response, Status};

pub struct IdentityServiceImpl {
    ctx: Arc<ServiceContext>,
}

#[tonic::async_trait]
impl IdentityService for IdentityServiceImpl {
    async fn is_moderator(
        &self,
        request: Request<IsModeratorRequest>,
    ) -> Result<Response<IsModeratorResponse>, Status> {
        Ok(Response::new(
            is_moderator::handle(&self.ctx, request).await?,
        ))
    }

    async fn set_ban_status(
        &self,
        request: Request<SetBanStatusRequest>,
    ) -> Result<Response<SetBanStatusResponse>, Status> {
        Ok(Response::new(
            set_ban_status::handle(&self.ctx, request).await?,
        ))
    }

    async fn is_banned(
        &self,
        request: Request<IsBannedRequest>,
    ) -> Result<Response<IsBannedResponse>, Status> {
        Ok(Response::new(is_banned::handle(&self.ctx, request).await?))
    }

    async fn list_bans(
        &self,
        request: Request<ListBansRequest>,
    ) -> Result<Response<ListBansResponse>, Status> {
        Ok(Response::new(list_bans::handle(&self.ctx, request).await?))
    }
}

/// Creates the identity gRPC service.
pub fn build_identity_service(
    ctx: Arc<ServiceContext>,
) -> IdentityServiceServer<IdentityServiceImpl> {
    IdentityServiceServer::new(IdentityServiceImpl { ctx })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::auth::AuthenticatedIdentity;
    use crate::service::verifications::rpc::common::tests::ctx;
    use chrono::Utc;
    use entity::{ban, moderator};
    use sea_orm::{DbBackend, MockDatabase};
    use tonic::Code;

    const MODERATOR: &str = "moderator-identity";
    const OTHER: &str = "some-other-identity";

    fn moderator_row() -> moderator::Model {
        let now = Utc::now();
        moderator::Model {
            identity: MODERATOR.to_string(),
            created_at: now,
            updated_at: now,
        }
    }

    fn ban_row(identity: &str) -> ban::Model {
        let now = Utc::now();
        ban::Model {
            identity: identity.to_string(),
            banned_by: Some(MODERATOR.to_string()),
            created_at: now,
            updated_at: now,
        }
    }

    /// A request carrying an authenticated identity, as `auth_middleware`
    /// would have populated it.
    fn authed<T>(message: T, identity: &str) -> Request<T> {
        let mut request = Request::new(message);
        request
            .extensions_mut()
            .insert(AuthenticatedIdentity(identity.to_string()));
        request
    }

    /// A context whose `is_moderator` lookup (the first query every
    /// moderation handler runs) reports whether the caller is a moderator.
    async fn ctx_moderator(is_moderator: bool) -> Arc<ServiceContext> {
        let rows = if is_moderator {
            vec![moderator_row()]
        } else {
            vec![]
        };
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([rows])
            .into_connection();
        ctx(db).await
    }

    /// A context with no queued query results — for the unauthenticated
    /// paths, which must reject before touching the database.
    async fn ctx_empty() -> Arc<ServiceContext> {
        ctx(MockDatabase::new(DbBackend::Postgres).into_connection()).await
    }

    #[tokio::test]
    async fn is_moderator_rejects_unauthenticated() {
        let ctx = ctx_empty().await;
        let err =
            is_moderator::handle(&ctx, Request::new(IsModeratorRequest {}))
                .await
                .unwrap_err();
        assert_eq!(err.code(), Code::Unauthenticated);
    }

    #[tokio::test]
    async fn is_moderator_false_for_non_moderator() {
        let ctx = ctx_moderator(false).await;
        let response =
            is_moderator::handle(&ctx, authed(IsModeratorRequest {}, OTHER))
                .await
                .unwrap();
        assert!(!response.is_moderator);
    }

    #[tokio::test]
    async fn is_moderator_true_for_moderator() {
        let ctx = ctx_moderator(true).await;
        let response = is_moderator::handle(
            &ctx,
            authed(IsModeratorRequest {}, MODERATOR),
        )
        .await
        .unwrap();
        assert!(response.is_moderator);
    }

    #[tokio::test]
    async fn is_banned_rejects_unauthenticated() {
        let ctx = ctx_empty().await;
        let request = Request::new(IsBannedRequest {
            target_identity: "target".to_string(),
        });
        let err = is_banned::handle(&ctx, request).await.unwrap_err();
        assert_eq!(err.code(), Code::Unauthenticated);
    }

    #[tokio::test]
    async fn is_banned_rejects_non_moderator() {
        let ctx = ctx_moderator(false).await;
        let request = authed(
            IsBannedRequest {
                target_identity: "target".to_string(),
            },
            OTHER,
        );
        let err = is_banned::handle(&ctx, request).await.unwrap_err();
        assert_eq!(err.code(), Code::PermissionDenied);
    }

    #[tokio::test]
    async fn is_banned_reports_status_for_moderator() {
        // is_moderator lookup (a moderator), then the ban lookup (banned).
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![moderator_row()]])
            .append_query_results([vec![ban_row("target")]])
            .into_connection();
        let ctx = ctx(db).await;
        let request = authed(
            IsBannedRequest {
                target_identity: "target".to_string(),
            },
            MODERATOR,
        );
        let response = is_banned::handle(&ctx, request).await.unwrap();
        assert!(response.is_banned);
    }

    #[tokio::test]
    async fn list_bans_rejects_non_moderator() {
        let ctx = ctx_moderator(false).await;
        let request = authed(ListBansRequest::default(), OTHER);
        let err = list_bans::handle(&ctx, request).await.unwrap_err();
        assert_eq!(err.code(), Code::PermissionDenied);
    }

    #[tokio::test]
    async fn list_bans_returns_page_for_moderator() {
        // is_moderator lookup, then the page of ban rows.
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![moderator_row()]])
            .append_query_results([vec![ban_row("aaa"), ban_row("bbb")]])
            .into_connection();
        let ctx = ctx(db).await;
        let response = list_bans::handle(
            &ctx,
            authed(ListBansRequest::default(), MODERATOR),
        )
        .await
        .unwrap();
        assert_eq!(
            response.banned_identities,
            vec!["aaa".to_string(), "bbb".to_string()]
        );
    }

    #[tokio::test]
    async fn set_ban_status_rejects_unauthenticated() {
        let ctx = ctx_empty().await;
        let request = Request::new(SetBanStatusRequest {
            target_identity: "target".to_string(),
            banned: true,
        });
        let err = set_ban_status::handle(&ctx, request).await.unwrap_err();
        assert_eq!(err.code(), Code::Unauthenticated);
    }

    #[tokio::test]
    async fn set_ban_status_rejects_non_moderator() {
        let ctx = ctx_moderator(false).await;
        let request = authed(
            SetBanStatusRequest {
                target_identity: "target".to_string(),
                banned: true,
            },
            OTHER,
        );
        let err = set_ban_status::handle(&ctx, request).await.unwrap_err();
        assert_eq!(err.code(), Code::PermissionDenied);
    }
}
