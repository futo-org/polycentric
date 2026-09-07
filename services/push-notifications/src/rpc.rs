//! gRPC `NotificationService` impl. Each method delegates to a
//! handler under `notifications/rpc/`.

pub mod register_push_notifications;
pub mod unregister_push_notifications;

use crate::context::Context;
use polycentric_common::models::protos_v2::notification_service_server::{
    NotificationService, NotificationServiceServer,
};
use polycentric_common::models::protos_v2::{
    ListNotificationsRequest, ListNotificationsResponse, RegisterPushNotificationResponse,
    SignedMessage, UnregisterPushNotificationResponse,
};
use std::sync::Arc;
use tonic::{Request, Response, Status};

#[derive(Clone)]
pub struct NotificationServiceImpl {
    ctx: Arc<Context>,
}

#[tonic::async_trait]
impl NotificationService for NotificationServiceImpl {
    async fn list_notifications(
        &self,
        _request: Request<ListNotificationsRequest>,
    ) -> Result<Response<ListNotificationsResponse>, Status> {
        // The notification feed is served by the main server, not the push
        // service.
        Err(Status::not_found(
            "Not implemented here. Use the main server.",
        ))
    }

    async fn register_push_notifications(
        &self,
        request: Request<SignedMessage>,
    ) -> Result<Response<RegisterPushNotificationResponse>, Status> {
        Ok(Response::new(
            register_push_notifications::handle(&self.ctx, request.into_inner()).await?,
        ))
    }

    async fn unregister_push_notifications(
        &self,
        request: Request<SignedMessage>,
    ) -> Result<Response<UnregisterPushNotificationResponse>, Status> {
        Ok(Response::new(
            unregister_push_notifications::handle(&self.ctx, request.into_inner()).await?,
        ))
    }
}

pub fn build_notification_service(
    ctx: Arc<Context>,
) -> NotificationServiceServer<NotificationServiceImpl> {
    NotificationServiceServer::new(NotificationServiceImpl { ctx })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manager::{NotificationManager, PushService};
    use crate::polycentric::PolycentricClient;
    use ed25519_dalek::{Signer, SigningKey};
    use polycentric_common::models::protos_v2::RegisterPushNotificationRequest;
    use polycentric_common::models::protos_v2::{KeyType, PublicKey};
    use prost::Message;
    use push_notifications_entity::push_token_model as PushTokenModel;
    use sea_orm::{DbBackend, MockDatabase};
    use time::OffsetDateTime;
    use tonic::Code;

    async fn impl_for_testing() -> NotificationServiceImpl {
        let ctx = Arc::new(Context {
            db: MockDatabase::new(DbBackend::Postgres).into_connection(),
            ro_db: MockDatabase::new(DbBackend::Postgres).into_connection(),
            notification_manager: NotificationManager::new(None),
            polycentric: PolycentricClient::new(vec![]),
            main_server: String::new(),
        });
        NotificationServiceImpl { ctx }
    }

    #[tokio::test]
    async fn register_rejects_signed_message_without_public_key() {
        let service = impl_for_testing().await;

        let request = Request::new(SignedMessage {
            public_key: None,
            signature: vec![],
            message_bytes: vec![],
        });

        let status = service
            .register_push_notifications(request)
            .await
            .expect_err("expected an error for missing public_key");

        assert_eq!(status.code(), Code::Unauthenticated);
    }

    #[tokio::test]
    async fn register_rejects_signed_message_with_invalid_signature() {
        let service = impl_for_testing().await;

        let signing_key = SigningKey::from_bytes(&[7u8; 32]);

        let message_bytes = RegisterPushNotificationRequest {
            service: PushService::Expo.as_ref().to_string(),
            token: "ExponentPushToken[abc123]".to_string(),
        }
        .encode_to_vec();

        let mut signature = signing_key.sign(&message_bytes).to_bytes().to_vec();
        // Corrupt the signature so verification fails despite the body being valid.
        signature[0] ^= 0xff;

        let request = Request::new(SignedMessage {
            public_key: Some(PublicKey {
                key_type: KeyType::Ed25519.into(),
                key: signing_key.verifying_key().to_bytes().to_vec(),
            }),
            signature,
            message_bytes,
        });

        let status = service
            .register_push_notifications(request)
            .await
            .expect_err("expected an error for invalid signature");

        assert_eq!(status.code(), Code::Unauthenticated);
    }

    #[tokio::test]
    async fn register_succeeds_with_valid_signed_message_and_token() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let public_key_bytes = signing_key.verifying_key().to_bytes().to_vec();

        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![PushTokenModel::Model {
                public_key_type: KeyType::Ed25519 as i16,
                public_key: public_key_bytes.clone(),
                service: PushService::Expo.as_ref().to_string(),
                token: "ExponentPushToken[abc123]".to_string(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            }]])
            .into_connection();

        let ctx = Arc::new(Context {
            db: db.clone(),
            ro_db: db,
            notification_manager: NotificationManager::new(None),
            polycentric: PolycentricClient::new(vec![]),
            main_server: String::new(),
        });
        let service = NotificationServiceImpl { ctx };

        let message_bytes = RegisterPushNotificationRequest {
            service: PushService::Expo.as_ref().to_string(),
            token: "ExponentPushToken[abc123]".to_string(),
        }
        .encode_to_vec();

        let signature = signing_key.sign(&message_bytes);

        let request = Request::new(SignedMessage {
            public_key: Some(PublicKey {
                key_type: KeyType::Ed25519.into(),
                key: public_key_bytes,
            }),
            signature: signature.to_bytes().to_vec(),
            message_bytes,
        });

        service
            .register_push_notifications(request)
            .await
            .expect("expected registration to succeed");
    }

    #[tokio::test]
    async fn register_rejects_unknown_service_identifier() {
        let service = impl_for_testing().await;

        let signing_key = SigningKey::from_bytes(&[7u8; 32]);

        let message_bytes = RegisterPushNotificationRequest {
            service: "not-a-real-service".to_string(),
            token: "some-token".to_string(),
        }
        .encode_to_vec();

        let signature = signing_key.sign(&message_bytes);

        let request = Request::new(SignedMessage {
            public_key: Some(PublicKey {
                key_type: KeyType::Ed25519.into(),
                key: signing_key.verifying_key().to_bytes().to_vec(),
            }),
            signature: signature.to_bytes().to_vec(),
            message_bytes,
        });

        let status = service
            .register_push_notifications(request)
            .await
            .expect_err("expected an error for unknown service identifier");

        assert_eq!(status.code(), Code::Unknown);
    }

    #[tokio::test]
    async fn register_rejects_signed_message_with_undecodable_body() {
        let service = impl_for_testing().await;

        let signing_key = SigningKey::from_bytes(&[7u8; 32]);

        // Wire type 7 is reserved, so this byte never decodes as a valid
        // protobuf message.
        let message_bytes = vec![0xffu8];
        let signature = signing_key.sign(&message_bytes);

        let request = Request::new(SignedMessage {
            public_key: Some(PublicKey {
                key_type: KeyType::Ed25519.into(),
                key: signing_key.verifying_key().to_bytes().to_vec(),
            }),
            signature: signature.to_bytes().to_vec(),
            message_bytes,
        });

        let status = service
            .register_push_notifications(request)
            .await
            .expect_err("expected an error for undecodable body");

        assert_eq!(status.code(), Code::InvalidArgument);
    }
}
