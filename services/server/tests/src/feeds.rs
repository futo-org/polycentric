//! Tests for the feeds service.

use crate::*;
use prost::Message;

#[tokio::test]
#[ignore] // Currently failing, to be fixed in #201.
async fn trusted_labels_served_in_feed_response() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();
    let mod_key = test_moderator_key();
    let mod_identity = test_moderator_identity();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "hello label world",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);
    let labels_sig = publish_labels(
        &mut event,
        &mod_identity,
        &mod_key,
        target_key.clone(),
        vec!["sexually-suggestive".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;

    // Get identity feed — no omit_labels.
    let resp = feed
        .get_identity_feed(GetIdentityFeedRequest {
            identity: author_identity.clone(),
            page_params: Some(PageParams {
                limit: Some(10),
                ..Default::default()
            }),
            omit_labels: vec![],
        })
        .await
        .expect("get_identity_feed failed")
        .into_inner();

    // Post is present.
    assert!(
        resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be returned in identity feed",
    );

    // Label event is present in event_hints.
    let label_bundle = resp
        .event_hints
        .iter()
        .find_map(|h| {
            let b = h.event_bundle.as_ref()?;
            if b.signed_event
                .as_ref()
                .map(|se| se.signature == labels_sig)
                .unwrap_or(false)
            {
                Some(b)
            } else {
                None
            }
        })
        .expect("Labels event should appear in event_hints");

    // The label event content decodes to a Labels targeting our post.
    assert_is_labels_bundle(
        label_bundle,
        &target_key,
        &["sexually-suggestive"],
    );

    // The label event carries the moderator identity (labeler visible).
    let label_event = label_bundle
        .signed_event
        .as_ref()
        .and_then(|se| Event::decode(se.event_bytes.as_slice()).ok())
        .expect("valid event bytes in label bundle");
    let label_event_key = label_event.key.as_ref().expect("event has key");
    assert_eq!(
        label_event_key.identity, mod_identity,
        "label event should carry the moderator identity",
    );
    assert_eq!(label_event_key.collection, COLLECTION_LABELS);
}

#[tokio::test]
async fn labeler_identity_served_with_feed_response() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();
    let mod_key = test_moderator_key();
    let mod_identity = test_moderator_identity();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;

    publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "post labeled by a stranger",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    publish_labels(
        &mut event,
        &mod_identity,
        &mod_key,
        get_post_event_key(&author_identity, &author_key),
        vec!["violence".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;

    let resp = feed
        .get_identity_feed(GetIdentityFeedRequest {
            identity: author_identity.clone(),
            page_params: Some(PageParams {
                limit: Some(10),
                ..Default::default()
            }),
            omit_labels: vec![],
        })
        .await
        .expect("get_identity_feed failed")
        .into_inner();

    let keys: Vec<EventKey> = resp
        .event_hints
        .iter()
        .filter_map(|hint| {
            let signed = hint.event_bundle.as_ref()?.signed_event.as_ref()?;
            Event::decode(signed.event_bytes.as_slice()).ok()?.key
        })
        .collect();

    let labeler_identity_served = keys.iter().any(|key| {
        key.collection == COLLECTION_IDENTITY && key.identity == mod_identity
    });

    assert!(
        labeler_identity_served,
        "labeler identity chain should be hinted so the client can \
         validate the Labels event",
    );
}

#[tokio::test]
#[ignore] // Currently failing, to be fixed in #201.
async fn omit_labels_hides_labeled_post() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();
    let mod_key = test_moderator_key();
    let mod_identity = test_moderator_identity();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "hide-me post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);
    publish_labels(
        &mut event,
        &mod_identity,
        &mod_key,
        target_key,
        vec!["sexually-suggestive".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;

    // Query with omit_labels = ["sexually-suggestive"] → post should be hidden.
    let resp = feed
        .get_identity_feed(GetIdentityFeedRequest {
            identity: author_identity,
            page_params: Some(PageParams {
                limit: Some(10),
                ..Default::default()
            }),
            omit_labels: vec!["sexually-suggestive".to_string()],
        })
        .await
        .expect("get_identity_feed failed")
        .into_inner();

    assert!(
        !resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be hidden when omit_labels contains 'sexually-suggestive'",
    );
}

#[tokio::test]
async fn attribution_feed_returns_only_matching_posts() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let url = format!("https://example.com/{}", random_string());
    let other_url = format!("https://example.com/{}", random_string());

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();
    let other_key = generate_signing_key();
    let other_identity = Identity {
        rotation_keys: vec![public_key_of(&other_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    publish_genesis(
        &mut event,
        &other_identity,
        &other_key,
        DEFAULT_CREATED_AT,
    )
    .await;

    let matching_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "post about the url",
        &[&url],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;
    let other_sig = publish_post(
        &mut event,
        &other_identity,
        &other_key,
        "post about a different url",
        &[&other_url],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let resp = feed
        .get_attribution_feed(attribution_feed_request(&url, vec![]))
        .await
        .expect("get_attribution_feed failed")
        .into_inner();

    assert!(
        resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == matching_sig)
            .unwrap_or(false)),
        "post attributed to the queried url should be returned",
    );
    assert!(
        !resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == other_sig)
            .unwrap_or(false)),
        "post attributed to a different url should not be returned",
    );
}

#[tokio::test]
#[ignore] // Currently failing, to be fixed in #201.
async fn attribution_feed_omit_labels_hides_labeled_post() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let url = format!("https://example.com/{}", random_string());

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();
    let mod_key = test_moderator_key();
    let mod_identity = test_moderator_identity();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "labeled post about the url",
        &[&url],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);
    publish_labels(
        &mut event,
        &mod_identity,
        &mod_key,
        target_key,
        vec!["sexually-suggestive".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;

    // Without omit_labels the post is served.
    let resp = feed
        .get_attribution_feed(attribution_feed_request(&url, vec![]))
        .await
        .expect("get_attribution_feed failed")
        .into_inner();
    assert!(
        resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be returned when no omit_labels",
    );

    // With a matching omit_labels the post is hidden.
    let resp = feed
        .get_attribution_feed(attribution_feed_request(
            &url,
            vec!["sexually-suggestive".to_string()],
        ))
        .await
        .expect("get_attribution_feed failed")
        .into_inner();
    assert!(
        !resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be hidden when omit_labels contains 'sexually-suggestive'",
    );
}

/// Build a `GetAttributionFeedRequest` for posts attributed to `url`.
fn attribution_feed_request(
    url: &str,
    omit_labels: Vec<String>,
) -> GetAttributionFeedRequest {
    GetAttributionFeedRequest {
        attributed_to: Some(AttributedTo {
            to: Some(attributed_to::To::Link(Link {
                url: url.to_string(),
                ..Default::default()
            })),
        }),
        page_params: Some(PageParams {
            limit: Some(10),
            ..Default::default()
        }),
        omit_labels,
    }
}

#[tokio::test]
#[ignore] // Currently failing, to be fixed in #201.
async fn omit_labels_non_matching_keeps_post_and_labels() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();
    let mod_key = test_moderator_key();
    let mod_identity = test_moderator_identity();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "warn-label post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);
    let labels_sig = publish_labels(
        &mut event,
        &mod_identity,
        &mod_key,
        target_key.clone(),
        vec!["sexually-suggestive".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;

    // Query with a different label — post should stay, label event should be
    // present in the collection (client renders Warn from the collection).
    let resp = feed
        .get_identity_feed(GetIdentityFeedRequest {
            identity: author_identity,
            page_params: Some(PageParams {
                limit: Some(10),
                ..Default::default()
            }),
            omit_labels: vec!["hate".to_string()],
        })
        .await
        .expect("get_identity_feed failed")
        .into_inner();

    // Post is present.
    assert!(
        resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be returned when omit_labels doesn't match its label",
    );

    // Label event is still in event_hints.
    let _label_bundle = resp
        .event_hints
        .iter()
        .find_map(|h| {
            let b = h.event_bundle.as_ref()?;
            if b.signed_event
                .as_ref()
                .map(|se| se.signature == labels_sig)
                .unwrap_or(false)
            {
                Some(b)
            } else {
                None
            }
        })
        .expect(
            "Labels event should still be present in event_hints for Warn/Show",
        );
}

#[tokio::test]
async fn untrusted_labels_not_indexed() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();

    // Impostor — a random key that is NOT the configured moderator.
    let impostor_key = generate_signing_key();
    let impostor_identity = Identity {
        rotation_keys: vec![public_key_of(&impostor_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;
    publish_genesis(
        &mut event,
        &impostor_identity,
        &impostor_key,
        DEFAULT_CREATED_AT,
    )
    .await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "test unmoderated",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);

    // Publish a Labels event from the impostor (NOT the trusted moderator).
    let impostor_labels_sig = publish_labels(
        &mut event,
        &impostor_identity,
        &impostor_key,
        target_key.clone(),
        vec!["sexually-suggestive".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;

    // Feed query — no omit_labels.
    let resp = feed
        .get_identity_feed(GetIdentityFeedRequest {
            identity: author_identity,
            page_params: Some(PageParams {
                limit: Some(10),
                ..Default::default()
            }),
            omit_labels: vec![],
        })
        .await
        .expect("get_identity_feed failed")
        .into_inner();

    // Post is present (not hidden — impostor's label is not trusted).
    assert!(
        resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be returned even though impostor labeled it",
    );

    // The impostor's Labels event is NOT in event_hints.
    assert!(
        !resp.event_hints.iter().any(|h| h
            .event_bundle
            .as_ref()
            .and_then(|b| b
                .signed_event
                .as_ref()
                .map(|se| se.signature == impostor_labels_sig))
            .unwrap_or(false)),
        "untrusted Labels event must NOT appear in event_hints collection",
    );
}

#[tokio::test]
async fn omit_labels_untrusted_label_does_not_hide() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();

    let impostor_key = generate_signing_key();
    let impostor_identity = Identity {
        rotation_keys: vec![public_key_of(&impostor_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;
    publish_genesis(
        &mut event,
        &impostor_identity,
        &impostor_key,
        DEFAULT_CREATED_AT,
    )
    .await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "impostor-labeled post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);
    publish_labels(
        &mut event,
        &impostor_identity,
        &impostor_key,
        target_key,
        vec!["sexually-suggestive".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;

    // Query with omit_labels = ["sexually-suggestive"] — the label came from an untrusted
    // source so it was never indexed; the post should NOT be hidden.
    let resp = feed
        .get_identity_feed(GetIdentityFeedRequest {
            identity: author_identity,
            page_params: Some(PageParams {
                limit: Some(10),
                ..Default::default()
            }),
            omit_labels: vec!["sexually-suggestive".to_string()],
        })
        .await
        .expect("get_identity_feed failed")
        .into_inner();

    assert!(
        resp.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "untrusted label must not be filterable via omit_labels — post should still appear",
    );
}

#[tokio::test]
async fn thread_no_labels_returns_post() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "thread test post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);

    let resp = feed
        .get_post_thread(GetPostThreadRequest {
            event_key: Some(target_key),
            limit: 10,
            omit_labels: vec![],
        })
        .await
        .expect("get_post_thread failed")
        .into_inner();

    // Post is present in the thread.
    assert!(
        resp.thread.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be returned in thread when no omit_labels",
    );

    // No label bundles in event_hints (no labels were published).
    for hint in &resp.event_hints {
        if let Some(bundle) = &hint.event_bundle {
            if let Some(se) = &bundle.signed_event {
                if let Ok(event) = Event::decode(se.event_bytes.as_slice()) {
                    if let Some(ek) = &event.key {
                        if ek.collection == COLLECTION_LABELS {
                            panic!(
                                "no Labels events should appear in hints without labels being published"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[tokio::test]
#[ignore] // Currently failing, to be fixed in #201.
async fn thread_omit_labels_matching_hides_post() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();
    let mod_key = test_moderator_key();
    let mod_identity = test_moderator_identity();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "hide-me thread post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);
    let labels_sig = publish_labels(
        &mut event,
        &mod_identity,
        &mod_key,
        target_key.clone(),
        vec!["sexually-suggestive".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;
    let resp = feed
        .get_post_thread(GetPostThreadRequest {
            event_key: Some(target_key.clone()),
            limit: 10,
            omit_labels: vec!["sexually-suggestive".to_string()],
        })
        .await
        .expect("get_post_thread failed")
        .into_inner();

    // Post is hidden from the thread.
    assert!(
        !resp.thread.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be hidden from thread when omit_labels matches",
    );

    // Label event is present in event_hints.
    let label_bundle = resp
        .event_hints
        .iter()
        .find_map(|h| {
            let b = h.event_bundle.as_ref()?;
            if b.signed_event
                .as_ref()
                .map(|se| se.signature == labels_sig)
                .unwrap_or(false)
            {
                Some(b)
            } else {
                None
            }
        })
        .expect("Labels event should appear in event_hints");

    assert_is_labels_bundle(
        label_bundle,
        &target_key,
        &["sexually-suggestive"],
    );
}

#[tokio::test]
#[ignore] // Currently failing, to be fixed in #201.
async fn thread_omit_labels_not_matching_keeps_post() {
    let mut event = connect_event_sync().await;
    let mut feed = connect_feeds().await;

    let author_key = generate_signing_key();
    let author_identity = Identity {
        rotation_keys: vec![public_key_of(&author_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    }
    .derive_hex_key();
    let mod_key = test_moderator_key();
    let mod_identity = test_moderator_identity();

    publish_genesis(
        &mut event,
        &author_identity,
        &author_key,
        DEFAULT_CREATED_AT,
    )
    .await;
    ensure_moderator_setup().await;

    let post_sig = publish_post(
        &mut event,
        &author_identity,
        &author_key,
        "warn thread post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    )
    .await;

    let target_key = get_post_event_key(&author_identity, &author_key);
    let labels_sig = publish_labels(
        &mut event,
        &mod_identity,
        &mod_key,
        target_key.clone(),
        vec!["sexually-suggestive".to_string()],
        DEFAULT_CREATED_AT + 2 * HOUR,
    )
    .await;

    let resp = feed
        .get_post_thread(GetPostThreadRequest {
            event_key: Some(target_key),
            limit: 10,
            omit_labels: vec!["hate".to_string()],
        })
        .await
        .expect("get_post_thread failed")
        .into_inner();

    // Post is present.
    assert!(
        resp.thread.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_sig)
            .unwrap_or(false)),
        "post should be returned when omit_labels doesn't match its label",
    );

    // Label event is still in event_hints.
    let _label_bundle = resp
        .event_hints
        .iter()
        .find_map(|h| {
            let b = h.event_bundle.as_ref()?;
            if b.signed_event
                .as_ref()
                .map(|se| se.signature == labels_sig)
                .unwrap_or(false)
            {
                Some(b)
            } else {
                None
            }
        })
        .expect(
            "Labels event should still be present in event_hints for non-matching omit",
        );
}

#[tokio::test]
async fn explore_feed_exists() {
    let mut feeds = connect_feeds().await;

    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    client.post_text("Post 2", current_timestamp());
    client.submit_events().await;

    let request = GetExploreFeedRequest {
        identity: None,
        page_params: None,
        omit_labels: Vec::new(),
        sort_by: Some(SortPostsBy::Top.into()),
    };
    let result = feeds.get_explore_feed(request).await.unwrap().into_inner();

    assert!(result.event_bundles.len() >= 2);
    // NOTE: because the global feed contains all posts made it's difficult to
    // test it without isolation, which we don't have between tests or between
    // test runs.
}

#[tokio::test]
async fn following_feed_empty() {
    let mut client = TestClient::new().await;
    client.submit_events().await;
    let follower = client.identity();

    // Not following anyone and hasn't made any posts themselves, so no results.
    following_feed(follower, &[]).await;
}

#[tokio::test]
async fn following_feed_includes_own_posts() {
    let mut client = TestClient::new().await;

    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;
    let follower = client.identity();

    following_feed(follower, &[post1_key]).await;
}

#[tokio::test]
async fn following_feed_includes_posts_by_followee() {
    let mut client = TestClient::new().await;

    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    following_feed(follower, &[post1_key]).await;
}

#[tokio::test]
async fn following_feed_ordering() {
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.post_text("Post 2", current_timestamp());
    let post2_key = client.get_last_event_key();
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.thumbs_up(post2_key.clone(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    following_feed(follower, &[post2_key, post1_key]).await;
}

#[tokio::test]
async fn following_feed_pagination() {
    // Followee 1, post 0 and 1.
    let mut client1 = TestClient::new().await;
    client1.post_text("Post 0", current_timestamp());
    let post0_key = client1.get_last_event_key();
    client1.post_text("Post 1", current_timestamp());
    let post1_key = client1.get_last_event_key();
    client1.submit_events().await;
    let followee1 = client1.identity().to_owned();

    // Followee 2, post 2.
    let mut client2 = TestClient::new().await;
    client2.post_text("Post 2", current_timestamp());
    let post2_key = client2.get_last_event_key();
    client2.submit_events().await;
    let followee2 = client2.identity().to_owned();

    // Follower, post 3.
    let mut client3 = TestClient::new().await;
    client3.post_text("Post 3", current_timestamp());
    let post3_key = client3.get_last_event_key();
    client3.follow_identity(followee1, current_timestamp());
    client3.follow_identity(followee2, current_timestamp());
    client3.submit_events().await;
    let follower = client3.identity().to_owned();

    // Post 0, 1 reaction.
    client2.thumbs_up(post1_key.clone(), current_timestamp());
    // Post 1, 1 reaction.
    client3.thumbs_up(post1_key.clone(), current_timestamp());
    // Post 2, 2 reactions.
    client3.thumbs_up(post2_key.clone(), current_timestamp());
    client2.thumbs_up(post2_key.clone(), current_timestamp());
    // Post 3, 3 reactions.
    client3.thumbs_up(post3_key.clone(), current_timestamp());
    client2.thumbs_up(post3_key.clone(), current_timestamp());
    client1.thumbs_up(post3_key.clone(), current_timestamp());
    client1.submit_events().await;
    client2.submit_events().await;
    client3.submit_events().await;

    let mut feeds = connect_feeds().await;

    // Forward.
    let mut page_info: Option<PageInfo> = None;
    let mut expected_iter = [
        post3_key.clone(),
        post2_key.clone(),
        post1_key.clone(),
        post0_key,
    ]
    .into_iter();
    while let Some(expected) = expected_iter.next() {
        let request = async {
            let request = GetFollowingFeedRequest {
                follower_identity: follower.clone(),
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: None,
                    forward_token: page_info.take().map(|i| i.end_cursor),
                }),
                omit_labels: Vec::new(),
                sort_by: Some(SortPostsBy::Top.into()),
            };
            let response = feeds
                .get_following_feed(request)
                .await
                .unwrap()
                .into_inner();
            page_info = response.page_info.clone();
            response
        };
        explore_feed(request, &[expected]).await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() != 3);
        assert_eq!(page_info.has_next_page, expected_iter.len() >= 1);
    }
    assert!(!page_info.as_ref().unwrap().has_next_page);

    // Backward.
    let mut expected_iter = [post1_key, post2_key, post3_key].into_iter();
    while let Some(expected) = expected_iter.next() {
        let request = async {
            let mut feeds = connect_feeds().await;
            let request = GetFollowingFeedRequest {
                follower_identity: follower.clone(),
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: page_info.take().map(|i| i.start_cursor),
                    forward_token: None,
                }),
                omit_labels: Vec::new(),
                sort_by: Some(SortPostsBy::Top.into()),
            };
            let response = feeds
                .get_following_feed(request)
                .await
                .unwrap()
                .into_inner();
            page_info = response.page_info.clone();
            response
        };
        explore_feed(request, &[expected]).await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() >= 1);
        assert_eq!(page_info.has_next_page, true);
    }
    assert!(!page_info.as_ref().unwrap().has_previous_page);
}

async fn following_feed(for_identity: &str, expected: &[EventKey]) {
    eprintln!("for_identity: {for_identity:?}");
    let request = async {
        let mut feeds = connect_feeds().await;
        let request = GetFollowingFeedRequest {
            follower_identity: for_identity.to_owned(),
            page_params: None,
            omit_labels: Vec::new(),
            sort_by: Some(SortPostsBy::Top.into()),
        };
        feeds
            .get_following_feed(request)
            .await
            .unwrap()
            .into_inner()
    };
    explore_feed(request, expected).await
}

#[tokio::test]
async fn recommended_feed_empty() {
    let mut client = TestClient::new().await;
    client.submit_events().await;
    let follower = client.identity();

    // Not following anyone and hasn't made any posts themselves, so no results.
    recommended_feed(follower, &[]).await;
}

#[tokio::test]
async fn recommended_feed_does_not_include_own_posts() {
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[]).await;
}

#[tokio::test]
async fn recommended_feed_includes_posts_by_followee() {
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[post1_key]).await;
}

#[tokio::test]
async fn recommended_feed_does_not_include_posts_reacted_self() {
    // NOTE: not following this identity.
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.thumbs_up(post1_key.clone(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[]).await;
}

#[tokio::test]
async fn recommended_feed_does_not_include_own_posts_even_with_followee_interaction()
 {
    let mut follower_client = TestClient::new().await;
    follower_client.post_text("Post 1", current_timestamp());
    let post1_key = follower_client.get_last_event_key();
    follower_client.submit_events().await;

    let mut followee_client = TestClient::new().await;
    followee_client.thumbs_up(post1_key.clone(), current_timestamp());
    followee_client.submit_events().await;
    let followee = followee_client.identity();

    follower_client.follow_identity(followee.to_owned(), current_timestamp());
    follower_client.submit_events().await;
    let follower = follower_client.identity();

    recommended_feed(follower, &[]).await;
}

#[tokio::test]
async fn recommended_feed_includes_posts_reacted_by_followee() {
    // NOTE: not following this identity.
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.thumbs_up(post1_key.clone(), current_timestamp());
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[post1_key]).await;
}

#[tokio::test]
async fn recommended_feed_does_not_include_posts_reposted_self() {
    // NOTE: not following this identity.
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.repost_key(post1_key.clone(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[]).await;
}

#[tokio::test]
async fn recommended_feed_includes_posts_reposted_by_followee() {
    // NOTE: not following this identity.
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.repost_key(post1_key.clone(), current_timestamp());
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[post1_key]).await;
}

#[tokio::test]
async fn recommended_feed_does_not_include_posts_quoted_self() {
    // NOTE: not following this identity.
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.quote(post1_key.clone(), "Reply 1", current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[]).await;
}

#[tokio::test]
async fn recommended_feed_includes_posts_quoted_by_followee() {
    // NOTE: not following this identity.
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.quote(post1_key.clone(), "Reply 1", current_timestamp());
    let reply1_key = client.get_last_event_key();
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[reply1_key, post1_key]).await;
}

#[tokio::test]
async fn recommended_feed_does_not_include_posts_replies_self() {
    // NOTE: not following this identity.
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.reply(post1_key.clone(), "Reply 1", current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[]).await;
}

#[tokio::test]
async fn recommended_feed_includes_posts_replies_by_followee() {
    // NOTE: not following this identity.
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.reply(post1_key.clone(), "Reply 1", current_timestamp());
    let reply1_key = client.get_last_event_key();
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[reply1_key, post1_key]).await;
}

#[tokio::test]
async fn recommended_feed_ordering() {
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.post_text("Post 2", current_timestamp());
    let post2_key = client.get_last_event_key();
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.thumbs_up(post2_key.clone(), current_timestamp());
    client.submit_events().await;
    let follower = client.identity();

    recommended_feed(follower, &[post2_key, post1_key]).await;
}

#[tokio::test]
async fn recommended_feed_pagination() {
    // Followee 1, post 0 and 1.
    let mut client1 = TestClient::new().await;
    client1.post_text("Post 0", current_timestamp());
    let post0_key = client1.get_last_event_key();
    client1.post_text("Post 1", current_timestamp());
    let post1_key = client1.get_last_event_key();
    client1.submit_events().await;
    let followee1 = client1.identity().to_owned();

    // Followee 2, post 2.
    let mut client2 = TestClient::new().await;
    client2.post_text("Post 2", current_timestamp());
    let post2_key = client2.get_last_event_key();
    client2.submit_events().await;
    let followee2 = client2.identity().to_owned();

    // Follower, post 3.
    let mut client3 = TestClient::new().await;
    client3.post_text("Post 3", current_timestamp());
    let post3_key = client3.get_last_event_key();
    client3.follow_identity(followee1, current_timestamp());
    client3.follow_identity(followee2, current_timestamp());
    client3.submit_events().await;
    let follower = client3.identity().to_owned();

    // Post 0, 1 reaction.
    client2.thumbs_up(post0_key.clone(), current_timestamp());
    // Post 1, 1 reaction.
    client3.thumbs_up(post1_key.clone(), current_timestamp());
    // Post 2, 2 reactions.
    client3.thumbs_up(post2_key.clone(), current_timestamp());
    client2.thumbs_up(post2_key.clone(), current_timestamp());
    // Post 3, 3 reactions.
    client3.thumbs_up(post3_key.clone(), current_timestamp());
    client2.thumbs_up(post3_key.clone(), current_timestamp());
    client1.thumbs_up(post3_key.clone(), current_timestamp());
    client1.submit_events().await;
    client2.submit_events().await;
    client3.submit_events().await;

    let mut feeds = connect_feeds().await;

    // Forward.
    let mut page_info: Option<PageInfo> = None;
    let mut expected_iter = [
        post3_key.clone(),
        post2_key.clone(),
        post1_key.clone(),
        post0_key.clone(),
    ]
    .into_iter();
    while let Some(expected) = expected_iter.next() {
        let request = async {
            let request = GetFollowingFeedRequest {
                follower_identity: follower.clone(),
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: None,
                    forward_token: page_info.take().map(|i| i.end_cursor),
                }),
                omit_labels: Vec::new(),
                sort_by: Some(SortPostsBy::Top.into()),
            };
            let response = feeds
                .get_following_feed(request)
                .await
                .unwrap()
                .into_inner();
            page_info = response.page_info.clone();
            response
        };
        explore_feed(request, &[expected]).await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() != 3);
        assert_eq!(page_info.has_next_page, expected_iter.len() >= 1);
    }
    assert!(!page_info.as_ref().unwrap().has_next_page);

    // Backward.
    let mut expected_iter = [post1_key, post2_key, post3_key].into_iter();
    while let Some(expected) = expected_iter.next() {
        let request = async {
            let mut feeds = connect_feeds().await;
            let request = GetFollowingFeedRequest {
                follower_identity: follower.clone(),
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: page_info.take().map(|i| i.start_cursor),
                    forward_token: None,
                }),
                omit_labels: Vec::new(),
                sort_by: Some(SortPostsBy::Top.into()),
            };
            let response = feeds
                .get_following_feed(request)
                .await
                .unwrap()
                .into_inner();
            page_info = response.page_info.clone();
            response
        };
        explore_feed(request, &[expected]).await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() >= 1);
        assert_eq!(page_info.has_next_page, true);
    }
    assert!(!page_info.as_ref().unwrap().has_previous_page);
}

#[tokio::test]
async fn recommended_feed_includes_metadata() {
    let mut client = TestClient::new().await;
    client.post_text("Post 1", current_timestamp());
    let post1_key = client.get_last_event_key();
    client.submit_events().await;

    let mut client = TestClient::new().await;
    client.thumbs_up(post1_key.clone(), current_timestamp());
    client.reply(post1_key.clone(), "Reply 1", current_timestamp());
    client.submit_events().await;
    let followee = client.identity();

    let mut client = TestClient::new().await;
    client.follow_identity(followee.to_owned(), current_timestamp());
    client.submit_events().await;

    let mut feeds = connect_feeds().await;
    let request = GetFollowingFeedRequest {
        follower_identity: client.identity().to_owned(),
        page_params: None,
        omit_labels: Vec::new(),
        sort_by: Some(SortPostsBy::Top.into()),
    };
    let result = feeds
        .get_recommended_feed(request)
        .await
        .unwrap()
        .into_inner();

    assert_eq!(result.event_bundles.len(), 2);
    let event_bundle = &result.event_bundles[0];
    let content = Content::decode(
        &*event_bundle
            .serialized_content
            .as_ref()
            .unwrap()
            .content_bytes,
    )
    .unwrap();
    if !matches!(&content.content_body, Some(ContentBody::Post(_))) {
        panic!("unexpected event content: {content:?}");
    };

    let event = Event::decode(
        &*event_bundle.signed_event.as_ref().unwrap().event_bytes,
    )
    .unwrap();
    let key = event.key.as_ref().unwrap();
    assert_eq!(key, &post1_key, "expected: {post1_key:?}, event: {event:?}");

    let metadata = event_bundle.meta.as_ref().unwrap();
    assert_eq!(metadata.reply_count, Some(1));
    assert_eq!(metadata.reaction_count, Some(1));
    assert_eq!(metadata.upvote_count, Some(1));
    assert_eq!(metadata.downvote_count, Some(0));
    assert_eq!(
        metadata.emoji_reactions,
        vec![ReactionTally {
            emoji: "👍".to_owned(),
            positive: true,
            count: 1,
        },]
    );
}

async fn recommended_feed(for_identity: &str, expected: &[EventKey]) {
    eprintln!("for_identity: {for_identity:?}");
    let request = async {
        let mut feeds = connect_feeds().await;
        let request = GetFollowingFeedRequest {
            follower_identity: for_identity.to_owned(),
            page_params: None,
            omit_labels: Vec::new(),
            sort_by: Some(SortPostsBy::Top.into()),
        };
        feeds
            .get_recommended_feed(request)
            .await
            .unwrap()
            .into_inner()
    };
    explore_feed(request, expected).await
}

async fn explore_feed<Fut>(request: Fut, expected: &[EventKey])
where
    Fut: Future<Output = GetFeedResponse>,
{
    eprintln!("expected: {expected:#?}");
    let result = request.await;
    eprintln!("results: {:#?}", &result.event_bundles);

    assert_eq!(result.event_bundles.len(), expected.len());
    for (event, expected) in result.event_bundles.iter().zip(expected) {
        let content = Content::decode(
            &*event.serialized_content.as_ref().unwrap().content_bytes,
        )
        .unwrap();
        if !matches!(&content.content_body, Some(ContentBody::Post(_))) {
            panic!("unexpected event content: {content:?}");
        };

        let event =
            Event::decode(&*event.signed_event.as_ref().unwrap().event_bytes)
                .unwrap();
        let key = event.key.as_ref().unwrap();
        assert_eq!(key, expected, "expected: {expected:?}, event: {event:?}");
    }
}
