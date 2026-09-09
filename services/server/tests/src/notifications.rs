//! Mention notifications end to end: the worker must resolve alias mentions
//! against the profiles claiming them (a real-DB check of
//! `find_identities_by_aliases`). Needs the `workers` process running.

use crate::*;
use polycentric_common::models::protos_v2::notification_service_client::NotificationServiceClient;
use std::time::{Duration, Instant};

const NOTIFICATION_TIMEOUT: Duration = Duration::from_secs(60);

#[tokio::test]
async fn mentions_notify_the_newest_alias_claimer_and_skip_the_reply_target() {
    let alias = format!("{}@example.com", random_string().to_lowercase());

    // Two profiles claim the same alias; the most recently synced one wins.
    let mut older_claimer = TestClient::new().await;
    older_claimer.profile_update(claim_alias(&alias), DEFAULT_CREATED_AT);
    older_claimer.submit_events().await;
    let mut newer_claimer = TestClient::new().await;
    newer_claimer.profile_update(claim_alias(&alias), DEFAULT_CREATED_AT);
    newer_claimer.submit_events().await;

    let mut parent_author = TestClient::new().await;
    parent_author.post_text("parent", DEFAULT_CREATED_AT);
    let parent_key = parent_author.get_last_event_key();
    parent_author.submit_events().await;

    let mut curly_mentioned = TestClient::new().await;
    curly_mentioned.submit_events().await;

    // Mixed case: alias lookup is case-insensitive.
    let mut author = TestClient::new().await;
    author.reply(
        parent_key,
        &format!(
            "hi @{} @{{{}}} @{{{},Someone}}",
            alias.to_uppercase(),
            parent_author.identity(),
            curly_mentioned.identity(),
        ),
        DEFAULT_CREATED_AT + HOUR,
    );
    author.submit_events().await;

    let author_identity = author.identity().to_owned();
    assert_eq!(
        wait_for_notifications(newer_claimer.identity(), 1).await,
        vec![(NotificationKind::Mention, author_identity.clone())],
        "newest alias claimer gets one Mention"
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
    // The mention path above already processed this post, so the older
    // claimer's absence is final rather than a timing artifact.
    assert!(
        wait_for_notifications(older_claimer.identity(), 0)
            .await
            .is_empty(),
        "older alias claimer gets nothing"
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

fn claim_alias(alias: &str) -> ProfileUpdate {
    ProfileUpdate {
        name: Some(random_string()),
        avatar: None,
        banner: None,
        description: None,
        alias: Some(alias.to_owned()),
    }
}
