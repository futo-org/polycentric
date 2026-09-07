//! `unregister_push_notifications`: remove a previously-registered push
//! token for the authenticated public key. Verifies the signed envelope
//! and decodes the inner request body, mirroring
//! `register_push_notifications`.

use crate::context::Context;
use polycentric_common::models::protos_v2::UnregisterPushNotificationRequest;
use polycentric_common::models::protos_v2::{SignedMessage, UnregisterPushNotificationResponse};
use prost::Message;
use tonic::Status;

pub async fn handle(
    ctx: &Context,
    signed_message: SignedMessage,
) -> Result<UnregisterPushNotificationResponse, Status> {
    let (public_key, message_bytes) = signed_message
        .open()
        .ok_or_else(|| Status::unauthenticated("invalid signature"))?;

    let request =
        UnregisterPushNotificationRequest::decode(message_bytes.as_slice()).map_err(|_| {
            Status::invalid_argument("Argument is not an UnregisterPushNotificationRequest")
        })?;

    ctx.notification_manager
        .unregister(&ctx.db, &public_key, &request.service, &request.token)
        .await
        .map_err(|err| Status::unknown(err.to_string()))?;

    Ok(UnregisterPushNotificationResponse {})
}
