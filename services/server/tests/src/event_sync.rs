//! Tests for the event sync service.

use crate::*;

#[tokio::test]
async fn list_events_empty_works() {
    let mut client = connect_event_sync().await;
    client
        .list_events(ListEventsRequest {
            size: Some(10),
            ..Default::default()
        })
        .await
        .expect("list_events failed");
    // No assertion on count — server may have prior state — just that the
    // call succeeds and decodes.
}

#[tokio::test]
async fn put_then_list_round_trip() {
    let mut client = TestClient::new().await;

    let post_signature = client.post_text("hello", DEFAULT_CREATED_AT + HOUR);

    client.submit_events().await;

    let identity = client.identity().to_owned();
    let response = client
        .event_sync_client()
        .list_events(ListEventsRequest {
            size: Some(100),
            filters: Some(ListEventsFilters {
                identity: Some(identity),
                ..Default::default()
            }),
        })
        .await
        .expect("list_events failed");

    let bundles = response.into_inner().event_bundles;
    assert!(
        bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_signature)
            .unwrap_or(false)),
        "expected our post in the list response",
    );
}

#[tokio::test]
async fn invalid_signature_rejected() {
    let mut client = connect_event_sync().await;
    let key = generate_signing_key();
    let initial = Identity {
        rotation_keys: vec![public_key_of(&key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let identity = initial.derive_hex_key();

    let mut bundle = make_post_bundle(
        &identity,
        &key,
        1,
        1,
        vec![1],
        vec![],
        "tampered",
        &[],
        DEFAULT_CREATED_AT,
    );
    if let Some(ref mut signed) = bundle.signed_event {
        signed.signature[0] ^= 0xFF;
    }

    let response = client
        .put_events(PutEventsRequest {
            event_bundles: vec![bundle],
        })
        .await
        .expect("put_events failed");
    let inner = response.into_inner();
    assert!(
        inner
            .errors
            .iter()
            .any(|e| e.message.contains("invalid signature")),
        "tampered signature must be rejected, got errors: {:?}",
        inner.errors,
    );
}

/// A revokes B after B has written two FEED events. The pre-revocation
/// event below the head must still appear in `list_events` AND carry a
/// valid `EventProof` whose audit path verifies against the head's
/// `previous_root`.
#[tokio::test]
async fn revoked_key_pre_revocation_events_remain_valid() {
    let mut client = connect_event_sync().await;
    let rotation_key = generate_signing_key();
    let signing_key = generate_signing_key();

    // Genesis content: rotation=[A], signing=[B].
    let initial = Identity {
        rotation_keys: vec![public_key_of(&rotation_key)],
        signing_keys: vec![public_key_of(&signing_key)],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let identity = initial.derive_hex_key();

    // Genesis identity event signed by A. Dedup keys = [A, B]; VC = [1, 0].
    let genesis = make_identity_bundle(
        &identity,
        &rotation_key,
        1,
        1,
        vec![1, 0],
        initial.clone(),
        DEFAULT_CREATED_AT,
    );
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![genesis],
        })
        .await
        .expect("genesis put failed");

    // B writes FEED event 1: previous_root is empty (no prior events).
    // VC for FEED: [A_max=0, B_max=1].
    let post_1 = make_post_bundle(
        &identity,
        &signing_key,
        1,
        1,
        vec![0, 1],
        vec![],
        "first post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    );
    let sig_1 = bundle_signature(&post_1);
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![post_1],
        })
        .await
        .expect("post_1 put failed");

    // B writes FEED event 2: previous_root commits to a one-leaf tree of sig_1.
    // VC for FEED: [A_max=0, B_max=2].
    let root_after_1 = leaf_hash(&sig_1);
    let post_2 = make_post_bundle(
        &identity,
        &signing_key,
        2,
        1,
        vec![0, 2],
        root_after_1.clone(),
        "second post",
        &[],
        DEFAULT_CREATED_AT + 2 * HOUR,
    );
    let sig_2 = bundle_signature(&post_2);
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![post_2],
        })
        .await
        .expect("post_2 put failed");

    // A rotates and revokes B. Target pins post_2 as head; its tree has
    // one leaf (post_1), so root = leaf_hash(sig_1) and leaf_count = 1.
    let revoked_content = Identity {
        rotation_keys: vec![public_key_of(&rotation_key)],
        signing_keys: vec![],
        revocation_bounds: vec![make_revocation_bound(
            &signing_key,
            COLLECTION_FEED,
            sig_2.clone(),
            root_after_1.clone(),
            1,
        )],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let rotation = make_identity_bundle(
        &identity,
        &rotation_key,
        2,
        1,
        vec![2, 0],
        revoked_content,
        DEFAULT_CREATED_AT + 3 * HOUR,
    );
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![rotation],
        })
        .await
        .expect("rotation put failed");

    // List events for the identity.
    let response = client
        .list_events(ListEventsRequest {
            size: Some(100),
            filters: Some(ListEventsFilters {
                identity: Some(identity),
                ..Default::default()
            }),
        })
        .await
        .expect("list_events failed");
    let bundles = response.into_inner().event_bundles;

    // Both of B's events should still be visible.
    let bundle_1 = bundles
        .iter()
        .find(|b| {
            b.signed_event
                .as_ref()
                .map(|se| se.signature == sig_1)
                .unwrap_or(false)
        })
        .expect("post_1 missing from list_events response");
    let bundle_2 = bundles
        .iter()
        .find(|b| {
            b.signed_event
                .as_ref()
                .map(|se| se.signature == sig_2)
                .unwrap_or(false)
        })
        .expect("post_2 missing from list_events response");

    // post_2 IS the head — server should attach no proof.
    assert!(
        bundle_2.event_proofs.is_empty(),
        "head event should carry no EventProof (it equals the target)",
    );

    // post_1 is a non-head pre-revocation event — server should attach
    // exactly one proof against post_2.
    assert_eq!(
        bundle_1.event_proofs.len(),
        1,
        "expected exactly one EventProof attached to post_1, got {}",
        bundle_1.event_proofs.len(),
    );
    let proof = &bundle_1.event_proofs[0];
    assert_eq!(
        proof.target_signature, sig_2,
        "proof's target must be the head event"
    );
    assert_eq!(proof.leaf_index, 0, "post_1 is at leaf index 0");
    assert!(
        proof.audit_path.is_empty(),
        "a single-leaf tree has an empty audit path; got {} hashes",
        proof.audit_path.len(),
    );

    // Cryptographically verify the proof against the head's recorded root.
    // For a one-leaf tree the root IS the leaf hash, so the verification
    // reduces to checking leaf_hash(sig_1) == root_after_1.
    assert_eq!(
        leaf_hash(&sig_1),
        root_after_1,
        "recomputed root should match the bound's recorded root",
    );
}

/// After A revokes B, B writes a third post (post-revocation). The server
/// still stores it (signatures verify), but `attach_proofs` can't build a
/// valid proof — post_3 is not a leaf of the head's tree — so the bundle
/// comes back with no `event_proofs`, which a downstream validator treats
/// as a post-revocation forgery.
#[tokio::test]
async fn post_revocation_event_returns_without_proof() {
    let mut client = connect_event_sync().await;
    let rotation_key = generate_signing_key();
    let signing_key = generate_signing_key();

    let initial = Identity {
        rotation_keys: vec![public_key_of(&rotation_key)],
        signing_keys: vec![public_key_of(&signing_key)],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let identity = initial.derive_hex_key();

    // Genesis.
    let genesis = make_identity_bundle(
        &identity,
        &rotation_key,
        1,
        1,
        vec![1, 0],
        initial.clone(),
        DEFAULT_CREATED_AT,
    );
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![genesis],
        })
        .await
        .expect("genesis put failed");

    // B writes post_1, then post_2.
    let post_1 = make_post_bundle(
        &identity,
        &signing_key,
        1,
        1,
        vec![0, 1],
        vec![],
        "first post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    );
    let sig_1 = bundle_signature(&post_1);
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![post_1],
        })
        .await
        .expect("post_1 put failed");

    let root_after_1 = leaf_hash(&sig_1);
    let post_2 = make_post_bundle(
        &identity,
        &signing_key,
        2,
        1,
        vec![0, 2],
        root_after_1.clone(),
        "second post",
        &[],
        DEFAULT_CREATED_AT + 2 * HOUR,
    );
    let sig_2 = bundle_signature(&post_2);
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![post_2],
        })
        .await
        .expect("post_2 put failed");

    // A rotates to revoke B. Target pins post_2 as the head.
    let revoked = Identity {
        rotation_keys: vec![public_key_of(&rotation_key)],
        signing_keys: vec![],
        revocation_bounds: vec![make_revocation_bound(
            &signing_key,
            COLLECTION_FEED,
            sig_2.clone(),
            root_after_1.clone(),
            1,
        )],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let rotation = make_identity_bundle(
        &identity,
        &rotation_key,
        2,
        1,
        vec![2, 0],
        revoked,
        DEFAULT_CREATED_AT + 3 * HOUR,
    );
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![rotation],
        })
        .await
        .expect("rotation put failed");

    // B forges a post_3 after revocation. The signature is valid (B still
    // holds the key), so the server stores it.
    let post_3 = make_post_bundle(
        &identity,
        &signing_key,
        3,
        1,
        vec![0, 3],
        node_hash(&leaf_hash(&sig_1), &leaf_hash(&sig_2)),
        "forged post",
        &[],
        DEFAULT_CREATED_AT + 4 * HOUR,
    );
    let sig_3 = bundle_signature(&post_3);

    // B forges a post_3 after revocation. The signature is valid (B still
    // holds the key), but `authorize_event_signer` rejects it because B's
    // key is revoked and post_3 is not within the committed bound. The
    // server returns the rejection in the response errors, not as a gRPC
    // error.
    let response = client
        .put_events(PutEventsRequest {
            event_bundles: vec![post_3],
        })
        .await
        .expect("put_events call succeeded");
    let inner = response.into_inner();
    assert!(
        inner.errors.iter().any(|e| e.message.contains("revoked")),
        "post-revocation event must be rejected, got errors: {:?}",
        inner.errors,
    );

    // Also verify it didn't end up in the events table by accident.
    let response = client
        .list_events(ListEventsRequest {
            size: Some(100),
            filters: Some(ListEventsFilters {
                identity: Some(identity),
                ..Default::default()
            }),
        })
        .await
        .expect("list_events failed");
    let bundles = response.into_inner().event_bundles;
    assert!(
        !bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == sig_3)
            .unwrap_or(false)),
        "post-revocation event must NOT appear in list_events",
    );
}

/// B writes three posts, but the version of post_2 that reaches the
/// server differs from the version the rotator hashed into the bound.
/// The server's canonical reconstruction yields a different root than
/// the bound records, so no proof can be generated for any of B's
/// pre-revocation events.
#[tokio::test]
async fn rewritten_event_invalidates_proofs() {
    let mut client = connect_event_sync().await;
    let rotation_key = generate_signing_key();
    let signing_key = generate_signing_key();

    let initial = Identity {
        rotation_keys: vec![public_key_of(&rotation_key)],
        signing_keys: vec![public_key_of(&signing_key)],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let identity = initial.derive_hex_key();

    // Genesis.
    let genesis = make_identity_bundle(
        &identity,
        &rotation_key,
        1,
        1,
        vec![1, 0],
        initial.clone(),
        DEFAULT_CREATED_AT,
    );
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![genesis],
        })
        .await
        .expect("genesis put failed");

    // post_1 — same in both views.
    let post_1 = make_post_bundle(
        &identity,
        &signing_key,
        1,
        1,
        vec![0, 1],
        vec![],
        "first post",
        &[],
        DEFAULT_CREATED_AT + HOUR,
    );
    let sig_1 = bundle_signature(&post_1);

    // post_2_original — the version the rotator hashes into the bound.
    // Never PUT to the server.
    let post_2_original = make_post_bundle(
        &identity,
        &signing_key,
        2,
        1,
        vec![0, 2],
        leaf_hash(&sig_1),
        "ORIGINAL second post",
        &[],
        DEFAULT_CREATED_AT + 2 * HOUR,
    );
    let sig_2_original = bundle_signature(&post_2_original);

    // post_3 — references the rotator's view of history. previous_root is
    // the MMR over [sig_1, sig_2_original].
    let root_after_2_original =
        node_hash(&leaf_hash(&sig_1), &leaf_hash(&sig_2_original));
    let post_3 = make_post_bundle(
        &identity,
        &signing_key,
        3,
        1,
        vec![0, 3],
        root_after_2_original.clone(),
        "third post",
        &[],
        DEFAULT_CREATED_AT + 3 * HOUR,
    );
    let sig_3 = bundle_signature(&post_3);

    // post_2_rewritten — different content at the same (collection, identity,
    // signer, sequence). This is what the server actually receives.
    let post_2_rewritten = make_post_bundle(
        &identity,
        &signing_key,
        2,
        1,
        vec![0, 2],
        leaf_hash(&sig_1),
        "REWRITTEN second post",
        &[],
        DEFAULT_CREATED_AT + 2 * HOUR,
    );

    // A revokes B. Target pins post_3 as head with the rotator's-view root.
    let revoked = Identity {
        rotation_keys: vec![public_key_of(&rotation_key)],
        signing_keys: vec![],
        revocation_bounds: vec![make_revocation_bound(
            &signing_key,
            COLLECTION_FEED,
            sig_3.clone(),
            root_after_2_original.clone(),
            2,
        )],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let rotation = make_identity_bundle(
        &identity,
        &rotation_key,
        2,
        1,
        vec![2, 0],
        revoked,
        DEFAULT_CREATED_AT + 4 * HOUR,
    );

    // PUT in order. Note: post_2_rewritten replaces post_2_original — the
    // original is never seen by the server.
    client
        .put_events(PutEventsRequest {
            event_bundles: vec![post_1, post_2_rewritten, post_3, rotation],
        })
        .await
        .expect("puts failed");

    // List events.
    let response = client
        .list_events(ListEventsRequest {
            size: Some(100),
            filters: Some(ListEventsFilters {
                identity: Some(identity.clone()),
                ..Default::default()
            }),
        })
        .await
        .expect("list_events failed");
    let bundles = response.into_inner().event_bundles;

    // post_1 must come back with NO proof — the server's canonical
    // reconstruction over [sig_1, sig_2_rewritten] yields a different root
    // than the bound recorded (which used sig_2_original).
    let bundle_1 = bundles
        .iter()
        .find(|b| {
            b.signed_event
                .as_ref()
                .map(|se| se.signature == sig_1)
                .unwrap_or(false)
        })
        .expect("post_1 missing from list_events response");
    assert!(
        bundle_1.event_proofs.is_empty(),
        "rewriting an in-tree event must invalidate proofs for sibling leaves; got {} proofs",
        bundle_1.event_proofs.len(),
    );

    // Sanity: the recomputed roots from the two views are in fact different.
    let root_after_2_rewritten = node_hash(
        &leaf_hash(&sig_1),
        &leaf_hash(&bundle_signature(&make_post_bundle(
            &identity,
            &signing_key,
            2,
            1,
            vec![0, 2],
            leaf_hash(&sig_1),
            "REWRITTEN second post",
            &[],
            DEFAULT_CREATED_AT + 2 * HOUR,
        ))),
    );
    assert_ne!(
        root_after_2_original, root_after_2_rewritten,
        "rewritten root must differ from the bound's recorded root",
    );
}

#[tokio::test]
async fn put_verification_claim_is_ingested_and_listable() {
    let mut client = connect_event_sync().await;
    let rotation_key = generate_signing_key();

    let initial = Identity {
        rotation_keys: vec![public_key_of(&rotation_key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let identity = initial.derive_hex_key();

    let genesis = make_identity_bundle(
        &identity,
        &rotation_key,
        1,
        1,
        vec![1],
        initial,
        DEFAULT_CREATED_AT,
    );
    let claim = make_verification_claim_bundle(
        &identity,
        &rotation_key,
        1,
        1,
        vec![1],
        "alice",
        DEFAULT_CREATED_AT + HOUR,
    );
    let claim_signature = bundle_signature(&claim);

    let response = client
        .put_events(PutEventsRequest {
            event_bundles: vec![genesis, claim],
        })
        .await
        .expect("put_events failed")
        .into_inner();
    // Ingestion (and the claim/schema child-table writes) must succeed.
    assert!(
        response.errors.is_empty(),
        "ingest reported errors: {:?}",
        response.errors
    );

    let listed = client
        .list_events(ListEventsRequest {
            size: Some(100),
            filters: Some(ListEventsFilters {
                identity: Some(identity),
                collection: Some(COLLECTION_VERIFICATIONS),
                ..Default::default()
            }),
        })
        .await
        .expect("list_events failed")
        .into_inner();

    assert!(
        listed.event_bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .is_some_and(|s| s.signature == claim_signature)),
        "stored verification claim not returned",
    )
}

#[tokio::test]
async fn events_submitted_twice_are_ignored() {
    let mut client = TestClient::new().await;
    let post_signature = client.post_text("hello", DEFAULT_CREATED_AT + HOUR);
    let pending = client.pending.clone();
    // Submit everything.
    client.submit_events().await;

    // And again.
    client.pending = pending;
    client.submit_events().await;

    let identity = client.identity().to_owned();
    let response = client
        .event_sync_client()
        .list_events(ListEventsRequest {
            size: Some(100),
            filters: Some(ListEventsFilters {
                identity: Some(identity),
                ..Default::default()
            }),
        })
        .await
        .expect("list_events failed");

    let bundles = response.into_inner().event_bundles;
    assert_eq!(bundles.len(), 2); // Identity & post.
    assert!(
        bundles.iter().any(|b| b
            .signed_event
            .as_ref()
            .map(|se| se.signature == post_signature)
            .unwrap_or(false)),
        "expected our post in the list response",
    );
}

#[tokio::test]
async fn events_with_different_content_but_same_key_should_error() {
    let mut client = TestClient::new().await;

    client.post_text("Hello World!", DEFAULT_CREATED_AT);

    // Break the sequence on purpose.
    client.collection_sequences[COLLECTION_FEED as usize].0 -= 1;
    client.post_text("Hello Mars!", DEFAULT_CREATED_AT);

    let event_bundles = take(&mut client.pending);
    assert_eq!(event_bundles.len(), 3); // 1 for identity + 2 posts.

    // Ensure the sequences are the same for the two post events.
    let post_event_sequence1 = event_bundles[1]
        .signed_event
        .as_ref()
        .unwrap()
        .open()
        .unwrap()
        .key
        .unwrap()
        .sequence;
    let post_event_sequence2 = event_bundles[1]
        .signed_event
        .as_ref()
        .unwrap()
        .open()
        .unwrap()
        .key
        .unwrap()
        .sequence;
    assert_eq!(post_event_sequence1, post_event_sequence2);

    let response = client
        .event_sync_client
        .put_events(PutEventsRequest {
            event_bundles: event_bundles.clone(),
        })
        .await
        .expect("put_events failed")
        .into_inner();

    assert_eq!(response.errors.len(), 1, "expected an error");
    for err in response.errors.iter() {
        // Second post with the invalid sequence.
        assert_eq!(err.event_bundle_index, 2);
    }
}
