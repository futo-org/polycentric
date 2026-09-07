//! `register_push_notifications`: persist a push token for the
//! authenticated public key. Verifies the signed envelope, decodes
//! the inner request body, then hands off to the notification
//! manager. Mutation — no pipeline.

use crate::context::Context;
use polycentric_common::models::protos_v2::RegisterPushNotificationRequest;
use polycentric_common::models::protos_v2::{RegisterPushNotificationResponse, SignedMessage};
use prost::Message;
use tonic::Status;

pub async fn handle(
    ctx: &Context,
    signed_message: SignedMessage,
) -> Result<RegisterPushNotificationResponse, Status> {
    let (public_key, message_bytes) = signed_message
        .open()
        .ok_or_else(|| Status::unauthenticated("invalid signature"))?;

    let request =
        RegisterPushNotificationRequest::decode(message_bytes.as_slice()).map_err(|_| {
            Status::invalid_argument("Argument is not a RegisterPushNotificationRequest")
        })?;

    ctx.notification_manager
        .register(&ctx.db, &public_key, request.service, request.token)
        .await
        .map_err(|err| Status::unknown(err.to_string()))?;

    Ok(RegisterPushNotificationResponse {})
}
