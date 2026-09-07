//! End-to-end CSAM pipeline test
//!
//! A post carrying an image is published to the server and checked by the
//! moderation service, which references a mock PhotoDNA API that always
//! reports true. The test asserts that the service purges the image blob
//! and publishes a CHILD_SAFETY report.
//!
//! It is `#[ignore]`d by default, because it requires the server stack
//! running before the test can run.

use common_object_store::{ObjectStore, ObjectStoreConfig};
use ed25519_dalek::{Signer, SigningKey};
use polycentric_common::models::{
    collections,
    protos_v2::{
        Blob, Content, ContentDigest, ContentDigestType, Event, EventBundle, EventKey, Identity,
        Image, ImageSet, KeyType, ListEventsFilters, ListEventsRequest, Post, PublicKey,
        PutEventsRequest, Report, ReportCategory, SerializedContent, SignedEvent,
        UploadBlobRequest, VectorClock, content::ContentBody,
        content_service_client::ContentServiceClient,
        event_sync_service_client::EventSyncServiceClient,
    },
};
use polycentric_core::query::channel;
use prost::Message;
use sha2::{Digest, Sha256};
use std::{
    env::var,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    time::sleep,
};

const CREATED_AT: u64 = 1736942400000; // 2025-01-15T12:00:00Z, ms
const HOUR: u64 = 3_600_000;

fn server_endpoint() -> String {
    var("POLYCENTRIC_TEST_SERVER").unwrap_or("http://localhost:3000".to_string())
}
fn database_endpoint() -> String {
    var("POLYCENTRIC_TEST_DATABASE_URL")
        .unwrap_or("postgres://postgres:testing@localhost:5432".to_string())
}
fn os_endpoint() -> String {
    var("POLYCENTRIC_TEST_OS_ENDPOINT").unwrap_or("http://localhost:9000".to_string())
}
fn kafka_endpoint() -> String {
    var("POLYCENTRIC_TEST_KAFKA_BROKERS").unwrap_or("localhost:9092".to_string())
}

#[tokio::test]
#[ignore = "spawns the moderation service against a live stack"]
async fn csam_match_purges_blob_and_publishes_report() {
    let store = test_object_store().await;

    // Seed the service's identity before it boots: it loads its identity once
    // at startup and skips reporting if absent. A fresh key per run keeps the
    // report chain independent.
    let mod_key = signing_key(0);
    let (mod_identity, mod_genesis) = make_identity(&mod_key);
    put_events(vec![mod_genesis])
        .await
        .expect("seed moderation identity (is the stack up?)");

    let (photodna_url, photodna_hits) = start_mock_photodna().await;

    let ready = Arc::new(AtomicBool::new(false));
    let mut child = spawn_moderation_service(
        &photodna_url,
        &hex::encode(mod_key.to_bytes()),
        &mod_identity,
    );
    tee_stderr(&mut child, ready.clone());

    // Wait for sync, then let Kafka assign partitions: the consumer reads
    // from `latest`, so the post must be produced after assignment.
    let deadline = Instant::now() + Duration::from_secs(45);
    while !ready.load(Ordering::SeqCst) && Instant::now() < deadline {
        sleep(Duration::from_millis(200)).await;
    }
    sleep(Duration::from_secs(5)).await;

    let user_key = signing_key(1);
    let (user_identity, user_genesis) = make_identity(&user_key);
    put_events(vec![user_genesis])
        .await
        .expect("put user identity");

    // Fresh bytes so the digest is unique: the service dedups on the content
    // digest, so a reused one would let a prior run's verdict skip the gate.
    let mut image = b"moderation-e2e image ".to_vec();
    image.extend_from_slice(&unique_bytes(2));
    let digest = sha256_digest(&image);
    let blob = Blob {
        digest: Some(digest.clone()),
        mime_type: "image/png".to_string(),
        size: image.len() as i64,
    };
    upload_blob(blob.clone(), image.clone())
        .await
        .expect("upload blob");

    // The blob must be fetchable before posting, else the CSAM gate is skipped.
    let deadline = Instant::now() + Duration::from_secs(15);
    while store.read_blob(&digest).await.is_err() {
        assert!(
            Instant::now() < deadline,
            "uploaded blob never became readable"
        );
        sleep(Duration::from_millis(500)).await;
    }

    let (post_key, post) = make_image_post(&user_key, &user_identity, &blob);
    put_events(vec![post]).await.expect("put image post");

    // Poll for both side effects: the blob purged and the report published.
    let (mut purged, mut reported) = (false, false);
    let deadline = Instant::now() + Duration::from_secs(60);
    while !(purged && reported) && Instant::now() < deadline {
        purged = purged
            || matches!(store.read_blob(&digest).await, Err(e) if e.kind() == std::io::ErrorKind::NotFound);
        reported = reported
            || report_exists(&mod_identity, &post_key)
                .await
                .unwrap_or(false);
        if !(purged && reported) {
            sleep(Duration::from_secs(1)).await;
        }
    }

    let hits = photodna_hits.load(Ordering::SeqCst);
    let _ = child.start_kill();

    assert!(hits > 0, "mock PhotoDNA was never called");
    assert!(
        purged,
        "CSAM image blob was not purged from the object store"
    );
    assert!(
        reported,
        "no CHILD_SAFETY report was published for the post"
    );
}

// ───────────────────────────── moderation service ───────────────────────────

/// Spawn the real moderation binary, configured for the local stack and the
/// mock PhotoDNA endpoint. Azure must construct but is never reached on the
/// CSAM short-circuit path, so its config is a throwaway.
fn spawn_moderation_service(
    photodna_url: &str,
    mod_seed_hex: &str,
    mod_identity: &str,
) -> tokio::process::Child {
    tokio::process::Command::new(env!("CARGO_BIN_EXE_moderation-service"))
        .env("DATABASE_URL", database_endpoint())
        .env("CONTENT_BLOB_OS_BUCKET", "polycentric-blobs")
        .env("CONTENT_BLOB_OS_ENDPOINT", os_endpoint())
        .env("CONTENT_BLOB_OS_FORCE_PATH_STYLE", "true")
        .env("CONTENT_BLOB_OS_ACCESS_KEY", "rustfsadmin")
        .env("CONTENT_BLOB_OS_SECRET_KEY", "rustfsadmin")
        .env("POLYCENTRIC_KAFKA_BROKERS", kafka_endpoint())
        // Read from the start of the topic so a consumer that finishes joining
        // the group after the post is produced still sees it, rather than
        // racing partition assignment against the test's fixed startup delay.
        .env("POLYCENTRIC_KAFKA_AUTO_OFFSET_RESET", "earliest")
        .env(
            "POLYCENTRIC_AZURE_CONTENT_SAFETY_ENDPOINT",
            "http://127.0.0.1:9",
        )
        .env("POLYCENTRIC_AZURE_CONTENT_SAFETY_KEY", "unused")
        .env("POLYCENTRIC_PHOTODNA_KEY", "mock-key")
        .env("POLYCENTRIC_PHOTODNA_ENDPOINT", photodna_url)
        .env("POLYCENTRIC_MODERATION_SIGNING_KEY", mod_seed_hex)
        .env("POLYCENTRIC_MODERATION_IDENTITY", mod_identity)
        .env("POLYCENTRIC_MODERATION_SERVERS", server_endpoint())
        .env("RUST_LOG", "info")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn moderation-service")
}

/// Echo the child's stderr to the test output and flip `ready` once it has
/// synced with the servers (after which its Kafka consumer is created).
fn tee_stderr(child: &mut tokio::process::Child, ready: Arc<AtomicBool>) {
    let stderr = child.stderr.take().expect("piped stderr");
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.contains("sync:") {
                ready.store(true, Ordering::SeqCst);
            }
            eprintln!("[moderation] {line}");
        }
    });
}

// ───────────────────────────── mock PhotoDNA ────────────────────────────────

/// HTTP server that answers every request with a PhotoDNA-shaped match
/// response (`Status.Code` 3000, `IsMatch` true). Returns its base URL and a
/// counter of requests served.
async fn start_mock_photodna() -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(AtomicUsize::new(0));
    let served = hits.clone();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            // Drain the request before replying so the client never sees a reset.
            let _ = read_http_request(&mut socket).await;
            served.fetch_add(1, Ordering::SeqCst);
            // Mirror the real PhotoDNA contract: a successfully processed
            // request carries `Status.Code` 3000. is_match treats any other
            // (or missing) code as an error, so the bare `{"IsMatch":true}`
            // this mock used to send would be rejected.
            let body = br#"{"Status":{"Code":3000,"Description":"OK"},"IsMatch":true}"#;
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(body).await;
            let _ = socket.shutdown().await;
        }
    });
    (format!("http://127.0.0.1:{port}"), hits)
}

/// Read one request: headers plus the `Content-Length` body.
async fn read_http_request(socket: &mut TcpStream) -> std::io::Result<()> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        let n = socket.read(&mut tmp).await?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&tmp[..n]);
    };
    let headers = String::from_utf8_lossy(&buf[..header_end]).to_ascii_lowercase();
    let len = headers
        .lines()
        .find_map(|l| l.strip_prefix("content-length:"))
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    while buf.len() < header_end + len {
        let n = socket.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
    }
    Ok(())
}

// ───────────────────────────── server clients ───────────────────────────────

async fn put_events(bundles: Vec<EventBundle>) -> Result<(), String> {
    let mut client = EventSyncServiceClient::new(channel(&server_endpoint()).await?);
    let errors = client
        .put_events(PutEventsRequest {
            event_bundles: bundles,
        })
        .await
        .map_err(|e| e.to_string())?
        .into_inner()
        .errors;
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("server rejected events: {errors:?}"))
    }
}

async fn upload_blob(blob: Blob, body: Vec<u8>) -> Result<(), String> {
    ContentServiceClient::new(channel(&server_endpoint()).await?)
        .upload_blob(UploadBlobRequest {
            blob: Some(blob),
            body,
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Whether a CHILD_SAFETY report targeting `target` exists under `identity`.
async fn report_exists(identity: &str, target: &EventKey) -> Result<bool, String> {
    let bundles = EventSyncServiceClient::new(channel(&server_endpoint()).await?)
        .list_events(ListEventsRequest {
            filters: Some(ListEventsFilters {
                collection: Some(collections::REPORTS),
                identity: Some(identity.to_string()),
                ..Default::default()
            }),
            size: Some(100),
        })
        .await
        .map_err(|e| e.to_string())?
        .into_inner()
        .event_bundles;

    Ok(bundles.iter().any(|b| {
        let Some(content) = b
            .serialized_content
            .as_ref()
            .and_then(|c| Content::decode(c.content_bytes.as_slice()).ok())
        else {
            return false;
        };
        matches!(
            content.content_body,
            Some(ContentBody::Report(Report { event_key: Some(ref k), category, .. }))
                if category == ReportCategory::ChildSafety as i32 && event_keys_match(k, target)
        )
    }))
}

fn event_keys_match(a: &EventKey, b: &EventKey) -> bool {
    a.collection == b.collection
        && a.identity == b.identity
        && a.sequence == b.sequence
        && a.signed_by.as_ref().map(|k| (&k.key_type, &k.key))
            == b.signed_by.as_ref().map(|k| (&k.key_type, &k.key))
}

async fn test_object_store() -> ObjectStore {
    ObjectStore::new(ObjectStoreConfig {
        bucket: "polycentric-blobs".to_string(),
        region: "us-east-1".to_string(),
        endpoint: Some(os_endpoint()),
        force_path_style: true,
        access_key: Some("rustfsadmin".to_string()),
        secret_key: Some("rustfsadmin".to_string()),
    })
    .await
}

// ───────────────────────────── event construction ───────────────────────────

/// A single-key genesis identity bundle and its derived identity string.
fn make_identity(key: &SigningKey) -> (String, EventBundle) {
    let content = Identity {
        rotation_keys: vec![public_key_of(key)],
        signing_keys: vec![],
        revocation_bounds: vec![],
        servers: None,
        recovery_key: None,
        recovery_signature: None,
    };
    let identity = content.derive_hex_key();
    let bundle = signed_bundle(
        &identity,
        key,
        collections::IDENTITY,
        Content {
            content_body: Some(ContentBody::Identity(content)),
        },
        CREATED_AT,
    );
    (identity, bundle)
}

/// A feed post referencing `blob` as its single image, plus the post's key.
fn make_image_post(key: &SigningKey, identity: &str, blob: &Blob) -> (EventKey, EventBundle) {
    let post = Post {
        text: "moderation e2e post with image".to_string(),
        reply: None,
        images: vec![ImageSet {
            images: vec![Image {
                blob: Some(blob.clone()),
                width: 1,
                height: 1,
            }],
        }],
        quote: None,
        links: vec![],
        labels: vec![],
        attributed_to: vec![],
    };
    let bundle = signed_bundle(
        identity,
        key,
        collections::FEED,
        Content {
            content_body: Some(ContentBody::Post(post)),
        },
        CREATED_AT + HOUR,
    );
    let key = EventKey {
        collection: collections::FEED,
        identity: identity.to_string(),
        signed_by: Some(public_key_of(key)),
        sequence: 1,
    };
    (key, bundle)
}

/// Build, sign, and bundle the first event in `collection` for `key`
/// (sequence 1, single-key vector clock, no prior chain).
fn signed_bundle(
    identity: &str,
    key: &SigningKey,
    collection: i32,
    content: Content,
    created_at: u64,
) -> EventBundle {
    let content_bytes = content.encode_to_vec();
    let event = Event {
        key: Some(EventKey {
            collection,
            identity: identity.to_string(),
            signed_by: Some(public_key_of(key)),
            sequence: 1,
        }),
        identity_sequence: 1,
        vector_clock: Some(VectorClock { sequence: vec![1] }),
        previous_signature: vec![],
        previous_root: vec![],
        content_digest: Some(sha256_digest(&content_bytes)),
        created_at,
        application: None,
    };
    let event_bytes = event.encode_to_vec();
    EventBundle {
        signed_event: Some(SignedEvent {
            signature: key.sign(&event_bytes).to_bytes().to_vec(),
            event_bytes,
        }),
        serialized_content: Some(SerializedContent { content_bytes }),
        event_proofs: vec![],
        meta: None,
    }
}

fn signing_key(salt: u8) -> SigningKey {
    SigningKey::from_bytes(&unique_bytes(salt))
}

/// 32 bytes that are distinct per run and per `salt`, derived from the wall
/// clock and pid. Used to keep identities and image digests unique across runs
/// — these are test fixtures, not secrets, so no CSPRNG is needed.
fn unique_bytes(salt: u8) -> [u8; 32] {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let mut seed = nanos.to_le_bytes().to_vec();
    seed.extend_from_slice(&std::process::id().to_le_bytes());
    seed.push(salt);
    sha256(&seed).try_into().unwrap()
}

fn public_key_of(key: &SigningKey) -> PublicKey {
    PublicKey {
        key_type: KeyType::Ed25519 as i32,
        key: key.verifying_key().to_bytes().to_vec(),
    }
}

fn sha256_digest(bytes: &[u8]) -> ContentDigest {
    ContentDigest {
        r#type: ContentDigestType::Sha256 as i32,
        value: sha256(bytes),
    }
}

fn sha256(data: &[u8]) -> Vec<u8> {
    Sha256::digest(data).to_vec()
}
