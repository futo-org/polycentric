use super::repository as token_repository;
use crate::{
    context::Context,
    expo_client::{ExpoClient, ExpoPushData, ExpoPushRequest, ExpoPushResponse, ExpoRichContent},
    render,
};
use polycentric_common::models::protos_v2::{
    Content, ContentDigest, Event, Notification, NotificationKind, PublicKey,
};
use prost::Message;
use sea_orm::{DbConn, DbErr, EnumIter};
use std::{error::Error, fmt};
use tracing::{debug, warn};

#[derive(EnumIter)]
pub enum PushService {
    Expo,
}

impl AsRef<str> for PushService {
    fn as_ref(&self) -> &str {
        match self {
            PushService::Expo => "expo",
        }
    }
}

#[derive(Debug)]
pub enum NotificationError {
    UnknownService(String),
    Database(DbErr),
    PushService(String),
}

impl fmt::Display for NotificationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NotificationError::UnknownService(s) => {
                write!(f, "unknown push service: {s}")
            }
            NotificationError::Database(e) => write!(f, "database error: {e}"),
            NotificationError::PushService(e) => {
                write!(f, "push service error: {e}")
            }
        }
    }
}

impl Error for NotificationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            NotificationError::Database(e) => Some(e),
            _ => None,
        }
    }
}

impl From<DbErr> for NotificationError {
    fn from(e: DbErr) -> Self {
        NotificationError::Database(e)
    }
}

/// The relevant internal data of a single push notification
struct NotificationData {
    collapse_id: String,
    title: String,
    body: String,
    data: Option<ExpoPushData>,
    rich_content: Option<ExpoRichContent>,
}

pub struct NotificationManager {
    expo_client: ExpoClient,
}

impl NotificationManager {
    pub fn new(expo_access_token: Option<String>) -> Self {
        NotificationManager {
            expo_client: ExpoClient::new(expo_access_token),
        }
    }

    #[cfg(test)]
    pub fn with_custom_push_url(expo_access_token: Option<String>, push_url: String) -> Self {
        NotificationManager {
            expo_client: ExpoClient::with_custom_push_url(expo_access_token, push_url),
        }
    }

    /// Registers a push token for a public key after verifying that the
    /// service is supported and the token is well-formed.
    pub async fn register(
        &self,
        db: &DbConn,
        public_key: &PublicKey,
        service: String,
        token: String,
    ) -> Result<(), NotificationError> {
        self.verify_token(&service, &token).await?;

        token_repository::Mutation::register(db, public_key, service.clone(), token).await?;

        tracing::info!(
            key = crate::render::key_fingerprint(&public_key.key),
            service,
            "push token registered"
        );
        Ok(())
    }

    /// Remove a registered push token for `public_key`.
    pub async fn unregister(
        &self,
        db: &DbConn,
        public_key: &PublicKey,
        service: &str,
        token: &str,
    ) -> Result<(), NotificationError> {
        token_repository::Mutation::unregister(db, public_key, service, token).await?;

        tracing::info!(
            key = crate::render::key_fingerprint(&public_key.key),
            service,
            "push token unregistered"
        );
        Ok(())
    }

    /// Send the push (if any) for a notification addressed to `to_identity`.
    /// The kind decides the message; the worker that produced the
    /// notification has already picked the recipient, excluded self-actions,
    /// and dropped unsolicited verifications.
    pub async fn process_notification(
        &self,
        ctx: &Context,
        to_identity: &str,
        notification: &Notification,
    ) -> Result<(), NotificationError> {
        let Ok(kind) = NotificationKind::try_from(notification.kind) else {
            return Ok(());
        };

        // Decode the triggering event (for the author identity and collapse
        // id) and its content (for the message body and deep link). Anything
        // that doesn't decode just produces no push.
        let Some(bundle) = notification.trigger_event.as_ref() else {
            return Ok(());
        };
        let Some(signed) = bundle.signed_event.as_ref() else {
            return Ok(());
        };
        let Ok(event) = Event::decode(signed.event_bytes.as_slice()) else {
            return Ok(());
        };
        let Some(key) = event.key.as_ref() else {
            return Ok(());
        };
        let Some(serialized) = bundle.serialized_content.as_ref() else {
            return Ok(());
        };
        let Ok(content) = Content::decode(serialized.content_bytes.as_slice()) else {
            return Ok(());
        };

        let Some(rendered) = render::render(kind, key, &content) else {
            return Ok(());
        };

        let collapse_id: String = {
            let sig = &signed.signature;
            // APNs has a strict 64 byte limit for the collapseId field
            let bytes = &sig[0..sig.len().min(28)];
            hex::encode(bytes)
        };

        // Author's profile (display name + avatar), fetched over gRPC.
        let author = &key.identity;
        let profile = ctx.polycentric.profile(author).await;
        let title = profile.name.unwrap_or_else(|| "Anonymous".to_string());
        let rich_content = avatar_rich_content(ctx, profile.avatar).await;

        debug!("Firing {kind:?} notification: from={author} to={to_identity} key={key:?}");

        let response = self
            .send_to_identity(
                ctx,
                to_identity,
                NotificationData {
                    collapse_id,
                    title,
                    body: rendered.body,
                    data: rendered.url.map(|url| ExpoPushData { url }),
                    rich_content,
                },
            )
            .await?;

        if let Some(errors) = ticket_errors(&response) {
            warn!(
                "{kind:?} notification errors: from={author} to={to_identity} key={key:?} errors=[{errors}]"
            );
        }

        Ok(())
    }

    /// Sends a push notification to every authorized key of an identity that
    /// has a registered token. Tokens reported as invalid by the push service
    /// are unregistered as part of the send.
    async fn send_to_identity(
        &self,
        ctx: &Context,
        identity: &str,
        notification: NotificationData,
    ) -> Result<ExpoPushResponse, NotificationError> {
        let authorized_keys = ctx.polycentric.authorized_keys(identity).await;

        let mut rows = vec![];

        for key in authorized_keys {
            let token_res = token_repository::Query::token_for_public_key(&ctx.ro_db, &key).await?;
            if let Some(token) = token_res {
                rows.push(token);
            }
        }

        let mut expo_tokens: Vec<(PublicKey, String)> = vec![];
        for row in rows {
            let public_key = PublicKey {
                key: row.public_key,
                key_type: row.public_key_type as i32,
            };

            expo_tokens.push((public_key, row.token));
        }

        if expo_tokens.is_empty() {
            tracing::debug!(identity, "no registered push tokens");
            return Ok(ExpoPushResponse { data: vec![] });
        }

        let expo_tokens_raw: Vec<String> = expo_tokens.iter().map(|item| item.1.clone()).collect();

        let expo_push_request = ExpoPushRequest {
            to: expo_tokens_raw,
            title: notification.title,
            body: notification.body,
            collapse_id: Some(notification.collapse_id),
            data: notification.data,
            rich_content: notification.rich_content,
        };

        let response = self
            .expo_client
            .post_requests(vec![expo_push_request])
            .await?;

        let errors = response.data.iter().filter(|t| t.status == "error").count();
        tracing::info!(
            identity,
            tokens = expo_tokens.len(),
            ticket_errors = errors,
            "push sent"
        );
        let meter = opentelemetry::global::meter("push-notifications");
        meter
            .u64_counter("push_notifications_sent")
            .build()
            .add(expo_tokens.len() as u64, &[]);
        meter
            .u64_counter("push_ticket_errors")
            .build()
            .add(errors as u64, &[]);

        self.clean_unregistered_push_tokens(ctx, &response, expo_tokens)
            .await?;

        Ok(response)
    }

    /// Removes any tokens from a given batch which are no longer registered from the database
    async fn clean_unregistered_push_tokens(
        &self,
        ctx: &Context,
        response: &ExpoPushResponse,
        expo_tokens: Vec<(PublicKey, String)>,
    ) -> Result<(), NotificationError> {
        if response.data.len() != expo_tokens.len() {
            warn!(
                "expo ticket count ({}) != token count ({}); skipping token cleanup",
                response.data.len(),
                expo_tokens.len()
            );
            return Ok(());
        }

        for (key_and_token, ticket) in expo_tokens.iter().zip(response.data.iter()) {
            if ticket.status != "error" {
                continue;
            }

            let error = ticket.details.as_ref().and_then(|d| d.error.as_deref());

            if error == Some("DeviceNotRegistered") {
                // The device's token is no longer valid — remove it.
                token_repository::Mutation::unregister(
                    &ctx.db,
                    &key_and_token.0,
                    PushService::Expo.as_ref(),
                    &key_and_token.1,
                )
                .await?;
                tracing::info!(
                    key = crate::render::key_fingerprint(&key_and_token.0.key),
                    "removed dead push token (DeviceNotRegistered)"
                );
            } else {
                warn!(
                    "expo push ticket error (token kept): {}",
                    error.unwrap_or("unknown error")
                );
            }
        }

        // Polling expo.get_push_notification_receipts would have added too much complexity
        // to be worthwhile in this initial implementation

        // However, it may become neccessary if we run into rate limiting issues
        // related to dead tokens

        Ok(())
    }

    /// Verifies that a token/service pair is valid and supported
    /// Expo is the only currently supported notification service
    async fn verify_token(&self, service: &str, _token: &str) -> Result<(), NotificationError> {
        if service == PushService::Expo.as_ref() {
            Ok(())
        } else {
            Err(NotificationError::UnknownService(service.to_string()))
        }
    }
}

/// Build the rich-content image (avatar) for a notification, when the
/// profile has an avatar and a CDN URL can be resolved. Returns `None`
/// otherwise — a missing avatar is never an error.
async fn avatar_rich_content(
    ctx: &Context,
    avatar: Option<ContentDigest>,
) -> Option<ExpoRichContent> {
    let digest = avatar?;
    let cdn_url = ctx.polycentric.cdn_url().await?;
    // Public blob URL, mirroring the server's `/blob/{type}_{hex(value)}`
    // route (and the client's `blobUrl`).
    Some(ExpoRichContent {
        image: format!("{cdn_url}/blob/{}", digest.to_id()),
    })
}

/// The error details of any failed tickets in a push response,
/// comma-separated, or `None` when every ticket succeeded. Lets callers
/// log failures while staying silent on success.
fn ticket_errors(response: &ExpoPushResponse) -> Option<String> {
    let errors: Vec<&str> = response
        .data
        .iter()
        .filter(|ticket| ticket.status == "error")
        .map(|ticket| {
            ticket
                .details
                .as_ref()
                .and_then(|details| details.error.as_deref())
                .unwrap_or("unknown error")
        })
        // DeviceNotRegistered is already handled by
        // clean_unregistered_push_tokens
        .filter(|error| *error != "DeviceNotRegistered")
        .collect();

    (!errors.is_empty()).then(|| errors.join(","))
}

#[cfg(test)]
mod tests {
    use crate::testing::*;
    use polycentric_common::models::protos_v2::{EventBundle, Notification, NotificationKind};
    use sea_orm::{DbBackend, MockDatabase, MockExecResult};

    /// A `Notification` of `kind` triggered by `trigger`, as the worker
    /// produces them.
    fn notification(kind: NotificationKind, trigger: EventBundle) -> Notification {
        Notification {
            trigger_event: Some(trigger),
            target_event: None,
            kind: kind as i32,
        }
    }

    /// Happy path end-to-end: a reply notification triggers exactly one Expo
    /// push to the recipient, titled with the author's RPC-fetched display
    /// name and carrying the rendered body and deep link.
    #[tokio::test]
    async fn notifies_the_recipient_via_expo() {
        let mut expo_server = mockito::Server::new_async().await;
        let send_mock = expo_server
            .mock("POST", "/--/api/v2/push/send")
            .match_header("content-type", "application/json")
            .match_body(mockito::Matcher::PartialJsonString(
                r#"[{"to":["ExponentPushToken[abc123]"],"title":"Alice","body":"Replied: hi","collapseId":"000102030405060708090a0b0c0d0e0f101112131415161718191a1b","data":{"url":"harbor:///id-author/post/abababababababab/1"}}]"#
                    .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json; charset=utf-8")
            .with_body(
                r#"{"data":[{"status":"ok","id":"00000000-0000-0000-0000-000000000001"}]}"#,
            )
            .expect(1)
            .create_async()
            .await;
        let expo_push_url = format!("{}/--/api/v2/push/send", expo_server.url());

        let pk = test_public_key(1);
        let polycentric = spawn_polycentric(MockEventSync {
            profile_name: Some("Alice".to_string()),
            identity_keys: vec![pk.clone()],
        })
        .await;

        let db = MockDatabase::new(DbBackend::Postgres)
            // token_for_public_key(recipient's authorized key) → one token
            .append_query_results([vec![token_row(&pk.key, "ExponentPushToken[abc123]")]])
            .into_connection();

        let ctx = make_ctx(db, expo_push_url, polycentric);
        let n = notification(NotificationKind::Reply, reply_post_bundle("id-author"));

        ctx.notification_manager
            .process_notification(&ctx, "id-recipient", &n)
            .await
            .expect("process_notification should succeed");

        send_mock.assert_async().await;
    }

    /// Kinds without a push message (repost, reaction, quote) never call Expo.
    #[tokio::test]
    async fn skips_kinds_that_render_nothing() {
        let mut expo_server = mockito::Server::new_async().await;
        let send_mock = expo_server
            .mock("POST", "/--/api/v2/push/send")
            .with_status(200)
            .with_body("{}")
            .expect(0)
            .create_async()
            .await;
        let expo_push_url = format!("{}/--/api/v2/push/send", expo_server.url());

        let polycentric = spawn_polycentric(MockEventSync {
            profile_name: Some("Alice".to_string()),
            identity_keys: vec![],
        })
        .await;

        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let ctx = make_ctx(db, expo_push_url, polycentric);
        let n = notification(NotificationKind::Repost, reply_post_bundle("id-author"));

        ctx.notification_manager
            .process_notification(&ctx, "id-recipient", &n)
            .await
            .expect("process_notification should succeed");

        send_mock.assert_async().await;
    }

    /// A `DeviceNotRegistered` ticket from Expo removes the token via a
    /// DELETE on `push_token`.
    #[tokio::test]
    async fn unregisters_token_on_device_not_registered() {
        let mut expo_server = mockito::Server::new_async().await;
        let send_mock = expo_server
            .mock("POST", "/--/api/v2/push/send")
            .with_status(200)
            .with_header("content-type", "application/json; charset=utf-8")
            .with_body(
                r#"{"data":[{"status":"error","message":"not registered","details":{"error":"DeviceNotRegistered"}}]}"#,
            )
            .expect(1)
            .create_async()
            .await;
        let expo_push_url = format!("{}/--/api/v2/push/send", expo_server.url());

        let pk = test_public_key(5);
        let polycentric = spawn_polycentric(MockEventSync {
            profile_name: Some("Alice".to_string()),
            identity_keys: vec![pk.clone()],
        })
        .await;

        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![token_row(&pk.key, "ExponentPushToken[dead-device]")]])
            // unregister DELETE — sea-orm issues this as exec, not query.
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let ctx = make_ctx(db.clone(), expo_push_url, polycentric);
        let n = notification(NotificationKind::Reply, reply_post_bundle("id-author"));

        ctx.notification_manager
            .process_notification(&ctx, "id-recipient", &n)
            .await
            .expect("process_notification should succeed");

        send_mock.assert_async().await;

        assert!(
            saw_push_token_delete(db),
            "expected an unregister DELETE on push_token"
        );
    }

    /// When Expo returns a ticket count that doesn't match the number of
    /// tokens sent, positional correlation is unreliable, so the unregister
    /// pass is skipped entirely — no token is removed (even though the
    /// tickets say `DeviceNotRegistered`).
    #[tokio::test]
    async fn skips_token_cleanup_on_ticket_count_mismatch() {
        let mut expo_server = mockito::Server::new_async().await;
        let send_mock = expo_server
            .mock("POST", "/--/api/v2/push/send")
            .with_status(200)
            .with_header("content-type", "application/json; charset=utf-8")
            // Two tickets for a single token → count mismatch.
            .with_body(
                r#"{"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}},{"status":"error","details":{"error":"DeviceNotRegistered"}}]}"#,
            )
            .expect(1)
            .create_async()
            .await;
        let expo_push_url = format!("{}/--/api/v2/push/send", expo_server.url());

        let pk = test_public_key(6);
        let polycentric = spawn_polycentric(MockEventSync {
            profile_name: Some("Alice".to_string()),
            identity_keys: vec![pk.clone()],
        })
        .await;

        // Only the token lookup is queued. If the guard failed and an
        // unregister were attempted, MockDatabase would error on the missing
        // exec result and the test would fail.
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![token_row(&pk.key, "ExponentPushToken[abc123]")]])
            .into_connection();

        let ctx = make_ctx(db.clone(), expo_push_url, polycentric);
        let n = notification(NotificationKind::Reply, reply_post_bundle("id-author"));

        ctx.notification_manager
            .process_notification(&ctx, "id-recipient", &n)
            .await
            .expect("process_notification should succeed");

        send_mock.assert_async().await;
        assert!(
            !saw_push_token_delete(db),
            "a ticket/token count mismatch must skip token cleanup"
        );
    }

    /// A ticket error other than `DeviceNotRegistered` (e.g. a transient
    /// `MessageRateExceeded`) must not unregister the token.
    #[tokio::test]
    async fn keeps_token_on_non_device_not_registered_error() {
        let mut expo_server = mockito::Server::new_async().await;
        let send_mock = expo_server
            .mock("POST", "/--/api/v2/push/send")
            .with_status(200)
            .with_header("content-type", "application/json; charset=utf-8")
            .with_body(
                r#"{"data":[{"status":"error","message":"rate limited","details":{"error":"MessageRateExceeded"}}]}"#,
            )
            .expect(1)
            .create_async()
            .await;
        let expo_push_url = format!("{}/--/api/v2/push/send", expo_server.url());

        let pk = test_public_key(7);
        let polycentric = spawn_polycentric(MockEventSync {
            profile_name: Some("Alice".to_string()),
            identity_keys: vec![pk.clone()],
        })
        .await;

        // No exec result queued: an erroneous unregister would error out.
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![token_row(&pk.key, "ExponentPushToken[rate-limited]")]])
            .into_connection();

        let ctx = make_ctx(db.clone(), expo_push_url, polycentric);
        let n = notification(NotificationKind::Reply, reply_post_bundle("id-author"));

        ctx.notification_manager
            .process_notification(&ctx, "id-recipient", &n)
            .await
            .expect("process_notification should succeed");

        send_mock.assert_async().await;
        assert!(
            !saw_push_token_delete(db),
            "non-DeviceNotRegistered errors must not unregister the token"
        );
    }
}
