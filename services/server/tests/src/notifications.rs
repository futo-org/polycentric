//! Mention notifications end to end: a post mentioning identities notifies
//! them, except the reply target, which gets its Reply only. Alias mentions
//! resolve through a real HTTPS domain's `.well-known/polycentric.json`, so
//! they aren't covered here (see the resolver's unit tests). Needs the
//! `workers` process running.

use crate::*;
use polycentric_common::models::protos_v2::notification_service_client::NotificationServiceClient;
use std::time::{Duration, Instant};

const NOTIFICATION_TIMEOUT: Duration = Duration::from_secs(60);

#[tokio::test]
async fn mentions_notify_identities_and_skip_the_reply_target() {
    let mut parent_author = TestClient::new().await;
    parent_author.post_text("parent", DEFAULT_CREATED_AT);
    let parent_key = parent_author.get_last_event_key();
    parent_author.submit_events().await;

    let mut curly_mentioned = TestClient::new().await;
    curly_mentioned.submit_events().await;
    let mut bare_mentioned = TestClient::new().await;
    bare_mentioned.submit_events().await;

    let mut author = TestClient::new().await;
    author.reply(
        parent_key,
        &format!(
            "hi @{} @{{{},Someone}} @{{{}}}",
            bare_mentioned.identity(),
            curly_mentioned.identity(),
            parent_author.identity(),
        ),
        DEFAULT_CREATED_AT + HOUR,
    );
    author.submit_events().await;

    let author_identity = author.identity().to_owned();
    assert_eq!(
        wait_for_notifications(bare_mentioned.identity(), 1).await,
        vec![(NotificationKind::Mention, author_identity.clone())],
        "bare identity mention gets one Mention"
    );
    assert_eq!(
        wait_for_notifications(curly_mentioned.identity(), 1).await,
        vec![(NotificationKind::Mention, author_identity.clone())],
        "curly identity mention gets one Mention"
    );
    assert_eq!(
        wait_for_notifications(parent_author.identity(), 1).await,
        vec![(NotificationKind::Reply, author_identity)],
        "reply parent that is also mentioned gets one Reply, no Mention"
    );
}

/// `(kind, author identity)` of each notification addressed to `identity`,
/// polled until at least `expected_count` arrive or the timeout passes.
async fn wait_for_notifications(
    identity: &str,
    expected_count: usize,
) -> Vec<(NotificationKind, String)> {
    let mut client = NotificationServiceClient::connect(grpc_addr())
        .await
        .expect("failed to connect to gRPC server");
    let deadline = Instant::now() + NOTIFICATION_TIMEOUT;
    loop {
        let notifications = client
            .list_notifications(ListNotificationsRequest {
                identity: identity.to_owned(),
                first: None,
                after: None,
                omit_labels: vec![],
            })
            .await
            .expect("list_notifications failed")
            .into_inner()
            .notifications;
        if notifications.len() >= expected_count || Instant::now() > deadline {
            return notifications
                .iter()
                .map(|n| {
                    let signed = n
                        .trigger_event
                        .as_ref()
                        .and_then(|b| b.signed_event.as_ref())
                        .expect("trigger event missing");
                    let event = Event::decode(&*signed.event_bytes).unwrap();
                    (n.kind.try_into().unwrap(), event.key.unwrap().identity)
                })
                .collect();
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
