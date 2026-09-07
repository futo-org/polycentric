mod config;
mod context;
mod db;
mod labels;
mod polycentric;
mod providers;
mod repository;

use std::collections::HashMap;
use std::time::Duration;

use common_kafka::{BorrowedMessage, CommitMode, Consumer, Message, Offset};
use common_object_store::{ObjectStore, ObjectStoreConfig};
use context::Context;
use polycentric::{PolycentricClient, PublishError};
use polycentric_common::models::{
    collections,
    protos_v2::{
        Content, ContentDigest, Event, EventBundle, EventKey, ImageSet, Report, ReportCategory,
        content::ContentBody,
    },
};
use providers::{
    azure::{AzureClient, ModerationRequest},
    photodna::PhotoDnaClient,
};
// Aliased: `Message` above is rdkafka's message trait; this brings the
// prost decode trait into scope without shadowing it.
use prost::Message as ProstMessage;
use sea_orm::sea_query::value::prelude::serde_json;

/// Duration before retrying a Retry event
const RETRY_BACKOFF: Duration = Duration::from_secs(2);

/// Number of times a message is retried before it is skipped (committed
/// past without being processed).
const MAX_RETRIES: u32 = 5;

/// Whether the consumed message's offset should be committed.
enum Outcome {
    /// Done with this message — commit so it is not redelivered.
    Commit,
    /// Transient failure — seek back so the message is re-delivered and
    /// retried (see the consume loop). After [`MAX_RETRIES`] it is skipped.
    Retry,
}

/// The content carried by an `EventBundle`, keyed by its content digest.
struct BundleContent {
    author_identity: String,
    digest_type: i32,
    digest_bytes: Vec<u8>,
    content: Content,
}

/// First 8 bytes of a content digest as hex, for log context.
fn digest_fp(digest: &[u8]) -> String {
    hex::encode(&digest[0..digest.len().min(8)])
}

/// Messages handled, by outcome (committed / retried / skipped).
static WORKER_MESSAGES: std::sync::LazyLock<opentelemetry::metrics::Counter<u64>> =
    std::sync::LazyLock::new(|| {
        opentelemetry::global::meter("moderation")
            .u64_counter("worker_messages")
            .build()
    });

fn count_message(outcome: &'static str) {
    WORKER_MESSAGES.add(
        1,
        &[
            opentelemetry::KeyValue::new("group", "moderation"),
            opentelemetry::KeyValue::new("outcome", outcome),
        ],
    );
}

/// Pull the content, digest, and author out of a bundle. Returns
/// `None` when the bundle carries no content or cannot be interpreted.
fn content_from_bundle(bundle: EventBundle) -> Option<BundleContent> {
    // No serialized content means there is nothing to moderate (e.g. a
    // delete or reaction event).
    let serialized_content = bundle.serialized_content?;

    // The content digest lives on the Event, which is serialized inside the
    // SignedEvent. It is the dedup key for moderation.
    let signed_event = match bundle.signed_event {
        Some(s) => s,
        None => {
            tracing::warn!("bundle missing signed_event");
            return None;
        }
    };

    let event = match Event::decode(signed_event.event_bytes.as_slice()) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(error = ?e, "failed to decode Event");
            return None;
        }
    };

    let digest = match event.content_digest {
        Some(d) => d,
        None => {
            tracing::warn!("event missing content_digest");
            return None;
        }
    };

    let author_identity = match event.key {
        Some(key) => key.identity,
        None => {
            tracing::warn!("event missing key");
            return None;
        }
    };

    let content = match Content::decode(serialized_content.content_bytes.as_slice()) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = ?e, "failed to decode Content");
            return None;
        }
    };

    Some(BundleContent {
        author_identity,
        digest_type: digest.r#type,
        digest_bytes: digest.value,
        content,
    })
}

/// Whether the content can be fed to automated content scoring. This skips empty
/// posts, reactions, follows, and the like.
fn has_scorable_media(content: &Content) -> bool {
    content_text(content).is_some() || !image_blobs(content).is_empty()
}

/// User-supplied text carried by the content, if any.
fn content_text(content: &Content) -> Option<String> {
    match content.content_body.as_ref()? {
        ContentBody::Post(post) => {
            let mut parts = Vec::new();
            if !post.text.is_empty() {
                parts.push(post.text.as_str());
            }
            // Link previews carry user-/site-supplied text worth moderating.
            for link in &post.links {
                for field in [&link.title, &link.description, &link.url] {
                    if !field.is_empty() {
                        parts.push(field.as_str());
                    }
                }
            }
            Some(parts.join("\n"))
        }
        ContentBody::ProfileUpdate(profile) => {
            let mut parts = Vec::new();
            if let Some(name) = &profile.name {
                parts.push(name.clone());
            }
            if let Some(description) = &profile.description {
                parts.push(description.clone());
            }
            if let Some(alias) = &profile.alias {
                parts.push(alias.clone());
            }
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        _ => None,
    }
}

/// The image sets carried by the content (a post's images, or a profile's
/// avatar and banner).
fn image_sets(content: &Content) -> Vec<&ImageSet> {
    match content.content_body.as_ref() {
        Some(ContentBody::Post(post)) => post.images.iter().collect(),
        Some(ContentBody::ProfileUpdate(profile)) => {
            profile.avatar.iter().chain(profile.banner.iter()).collect()
        }
        _ => Vec::new(),
    }
}

/// Digest and claimed MIME type of one variant per distinct image in the
/// content. The MIME type is client-supplied (and may be empty), so treat it
/// only as a hint.
fn image_blobs(content: &Content) -> Vec<(&ContentDigest, &str)> {
    image_sets(content)
        .into_iter()
        // One variant (size) per image is enough to moderate it.
        .filter_map(|set| set.images.first())
        .filter_map(|image| image.blob.as_ref())
        .filter_map(|blob| Some((blob.digest.as_ref()?, blob.mime_type.as_str())))
        .collect()
}

/// Fetch the bytes of every image referenced by the content. Images that
/// fail to fetch are skipped (logged).
async fn fetch_images(ctx: &Context, content: &Content) -> Vec<(Vec<u8>, String)> {
    let store = &ctx.blobs;
    let mut images = Vec::new();
    for (digest, mime) in image_blobs(content) {
        match store.read_blob(digest).await {
            Ok(bytes) => images.push((bytes, mime.to_string())),
            Err(e) => tracing::warn!(error = %e, "failed to fetch image blob"),
        }
    }
    images
}

/// Purge every image blob referenced by `content` from the object store.
async fn purge_images(ctx: &Context, content: &Content) -> Result<(), ()> {
    let store = &ctx.blobs;
    let mut ok = true;
    for (digest, _mime) in image_blobs(content) {
        if let Err(e) = store.delete_blob(digest).await {
            tracing::error!(error = %e, "failed to purge CSAM image blob");
            ok = false;
        }
    }
    if ok { Ok(()) } else { Err(()) }
}

/// Run the content through Azure and return its raw response(s). Every
/// image is scanned (with the post text when present). `Err` signals a
/// provider failure so the row can be marked `FAILED`.
async fn moderate(
    ctx: &Context,
    content: &Content,
    images: &[(Vec<u8>, String)],
) -> Result<serde_json::Value, ()> {
    let Some(client) = &ctx.azure else {
        return Ok(no_findings());
    };

    let text = content_text(content);

    let analyze = |request| async {
        client.analyze(request).await.map_err(|e| {
            tracing::warn!(error = %e, "azure analyze error");
        })
    };

    // Each image is scanned with the text (multimodal) when text is
    // present, otherwise on its own.
    let mut image_results = Vec::with_capacity(images.len());
    for (image, _mime) in images {
        if let Some(request) = ModerationRequest::from_parts(text.as_deref(), Some(image)) {
            image_results.push(analyze(request).await?);
        }
    }

    // With no images, analyze the text on its own (if any).
    let text_result = if images.is_empty() {
        match ModerationRequest::from_parts(text.as_deref(), None) {
            Some(request) => Some(analyze(request).await?),
            None => None,
        }
    } else {
        None
    };

    Ok(serde_json::json!({
        "text": text_result,
        "images": image_results,
    }))
}

/// An Azure-shaped response carrying no findings, used when automatic content scoring
/// is disabled.
fn no_findings() -> serde_json::Value {
    serde_json::json!({ "text": null, "images": [] })
}

/// Run every image through PhotoDNA and report whether any is a CSAM match.
/// When PhotoDNA is unconfigured, it will simply accept all images and
/// never report a CSAM match. Any other error will return an error result,
/// to ensure that callers retry rather than silently skipping CSAM.
async fn photodna_filter(ctx: &Context, images: &[(Vec<u8>, String)]) -> Result<bool, ()> {
    let Some(photodna) = &ctx.photodna else {
        return Ok(false);
    };

    for (image, mime) in images {
        let hint = (!mime.is_empty()).then_some(mime.as_str());
        match photodna.is_match(image, hint).await {
            Ok(true) => return Ok(true),
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(error = %e, "photodna match error");
                return Err(());
            }
        }
    }

    Ok(false)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load .env before anything reads the environment.
    common_dotenv::load(".env");
    let config = config::init()?;

    common_telemetry::init();
    common_telemetry::init_metrics("moderation");

    // Shared connection, then run migrations on every load.
    let (db, ro_db) = db::connect().await?;
    db::run_migrations(&db).await?;

    let azure = match &config.azure {
        Some(azure) => Some(AzureClient::new(
            &azure.endpoint,
            &azure.key,
            &azure.api_version,
            &azure.multimodal_api_version,
        )),
        None => {
            tracing::warn!(
                "Azure Content Safety not configured; labels now published only from moderator reports"
            );
            None
        }
    };
    let blobs = ObjectStore::new(ObjectStoreConfig::from_env()?).await;

    // PhotoDNA is optional: if it is not configured, warn and moderate
    // with Azure alone
    let photodna = match &config.photodna_key {
        Some(key) => Some(PhotoDnaClient::new(&config.photodna_endpoint, key, true)),
        None => {
            tracing::warn!("PhotoDNA not configured, CSAM scanning disabled");
            None
        }
    };

    // Our own Polycentric identity, used to sign + publish labels events.
    let polycentric = PolycentricClient::new(config)?;
    // Reconcile with the servers before consuming: pulls our identity state
    // so the first labels event we author continues our chain correctly, and
    // re-pushes anything a server missed while it (or we) was unavailable.
    let created = repository::created_bundles(&ro_db, polycentric.identity())
        .await
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "could not load authored events for sync");
            Vec::new()
        });
    polycentric.sync(created).await;

    let ctx = Context {
        db,
        ro_db,
        azure,
        photodna,
        blobs,
        polycentric,
    };

    // Listen to a Kafka topic of all events.
    let consumer = common_kafka::build_consumer("events", &["events"]).await;

    // Failure counts for messages currently being retried.
    let mut attempts: HashMap<(i32, i64), u32> = HashMap::new();

    loop {
        let message = match consumer.recv().await {
            Ok(message) => message,
            Err(e) => {
                tracing::warn!(error = %e, "kafka error");
                continue;
            }
        };

        let coord = (message.partition(), message.offset());

        match process(&ctx, &message).await {
            Outcome::Commit => {
                attempts.remove(&coord);
                count_message("committed");
                if let Err(e) = consumer.commit_message(&message, CommitMode::Async) {
                    tracing::warn!(error = %e, "failed to commit offset");
                }
            }
            Outcome::Retry => {
                let failures = {
                    let count = attempts.entry(coord).or_insert(0);
                    *count += 1;
                    *count
                };

                if failures > MAX_RETRIES {
                    count_message("skipped");
                    // Retries exhausted — give up and commit past this message
                    // so the partition can make progress.
                    tracing::error!(
                        partition = coord.0,
                        offset = coord.1,
                        failures,
                        "message failed repeatedly; skipping"
                    );
                    attempts.remove(&coord);
                    if let Err(e) = consumer.commit_message(&message, CommitMode::Async) {
                        tracing::warn!(error = %e, "failed to commit offset after skip");
                    }
                } else {
                    count_message("retried");
                    // Seek back so the next poll re-delivers this message, then
                    // back off to avoid a hot loop.
                    if let Err(e) = consumer.seek(
                        message.topic(),
                        message.partition(),
                        Offset::Offset(message.offset()),
                        Duration::from_secs(5),
                    ) {
                        tracing::warn!(error = %e, "failed to seek for retry");
                    }
                    tokio::time::sleep(RETRY_BACKOFF).await;
                }
            }
        }
    }
}

/// Validate, deduplicate, and run moderation for a single consumed message.
async fn process(ctx: &Context, message: &BorrowedMessage<'_>) -> Outcome {
    // Key is a protobuf-encoded EventKey, payload a protobuf EventBundle
    // (see the server's put_events Kafka publish).
    let key = message
        .key()
        .and_then(|bytes| match EventKey::decode(bytes) {
            Ok(k) => Some(k),
            Err(e) => {
                tracing::warn!(error = ?e, "failed to decode EventKey");
                None
            }
        });

    let bundle = match message.payload() {
        Some(bytes) => match EventBundle::decode(bytes) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = ?e, "failed to decode EventBundle");
                return Outcome::Commit;
            }
        },
        None => return Outcome::Commit,
    };

    let BundleContent {
        author_identity,
        digest_type,
        digest_bytes,
        content,
    } = match content_from_bundle(bundle) {
        Some(c) => c,
        None => return Outcome::Commit,
    };

    if let Some(ContentBody::Report(report)) = &content.content_body {
        return process_moderator_report(ctx, &author_identity, report).await;
    }

    if !has_scorable_media(&content) {
        return Outcome::Commit;
    }

    // Obtain the Azure result: reuse a prior one if this content was already
    // processed, otherwise run Azure now and persist the outcome.
    let azure_response = match repository::get_content(
        &ctx.ro_db,
        digest_type,
        digest_bytes.clone(),
    )
    .await
    {
        // Already processed by Azure — skip the Azure step and reuse the
        // stored result (we still confirm the labels event below).
        Ok(Some(row)) => match row.azure_response {
            Some(response) => response,
            None => {
                // Content flagged as CSAM skips Azure responses. Re-run purging/reporting
                // just in case.
                if row.is_csam == Some(true) {
                    if purge_images(ctx, &content).await.is_err() {
                        return Outcome::Retry;
                    }
                    report_csam(ctx, &key).await;
                }
                return Outcome::Commit;
            }
        },
        Ok(None) => {
            // Reserve the row in the PENDING state before processing.
            if let Err(e) =
                repository::create_pending(&ctx.db, digest_type, digest_bytes.clone()).await
            {
                tracing::warn!(error = %e, digest = digest_fp(&digest_bytes), "create_pending error");
                return Outcome::Retry;
            }

            let images = fetch_images(ctx, &content).await;

            match photodna_filter(ctx, &images).await {
                // CSAM: record it, then purge the image blobs and report it.
                // Do not run Azure or labels.
                Ok(true) => {
                    // If we get an error, retry (CSAM should not be ignored).
                    if let Err(e) =
                        repository::mark_csam(&ctx.db, digest_type, digest_bytes.clone()).await
                    {
                        tracing::error!(error = %e, digest = digest_fp(&digest_bytes), "mark_csam error");
                        return Outcome::Retry;
                    }
                    tracing::error!(key = ?key, digest = digest_fp(&digest_bytes), "CSAM match");
                    opentelemetry::global::meter("moderation")
                        .u64_counter("moderation_csam_matches")
                        .build()
                        .add(1, &[]);
                    if purge_images(ctx, &content).await.is_err() {
                        return Outcome::Retry;
                    }
                    report_csam(ctx, &key).await;
                    return Outcome::Commit;
                }
                Ok(false) => {}
                // Retry on error, so that we don't skip the CSAM check.
                Err(()) => return Outcome::Retry,
            }

            match moderate(ctx, &content, &images).await {
                Ok(response) => {
                    if let Err(e) = repository::store_azure_result(
                        &ctx.db,
                        digest_type,
                        digest_bytes.clone(),
                        response.clone(),
                    )
                    .await
                    {
                        tracing::warn!(error = %e, digest = digest_fp(&digest_bytes), "store_azure_result error");
                        return Outcome::Retry;
                    }
                    response
                }
                Err(()) => {
                    if let Err(e) =
                        repository::mark_failed(&ctx.db, digest_type, digest_bytes.clone()).await
                    {
                        tracing::warn!(error = %e, digest = digest_fp(&digest_bytes), "mark_failed error");
                        return Outcome::Retry;
                    }
                    // Azure failed — nothing to label.
                    return Outcome::Commit;
                }
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, digest = digest_fp(&digest_bytes), "get_content error");
            return Outcome::Retry;
        }
    };

    // Confirm a labels event exists for this content. Derive the labels from
    // the Azure result; if any apply, look up whether we have already created
    // the (deterministic) labels content — publish it only if we have not.
    let labels = labels::labels_from_azure(&azure_response);
    if !labels.is_empty() {
        match key.clone() {
            Some(target) => {
                let digest = polycentric::labels_content(&target, &labels).1;
                match repository::created_content_exists(&ctx.ro_db, digest.r#type, digest.value)
                    .await
                {
                    Ok(true) => {
                        tracing::debug!(key = ?key, "labels event already created, skipping")
                    }
                    Ok(false) => {
                        if let Outcome::Retry = publish_labels(ctx, target, labels).await {
                            return Outcome::Retry;
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "created_content_exists error");
                        return Outcome::Retry;
                    }
                }
            }
            None => tracing::warn!("cannot publish labels: message had no decodable event key"),
        }
    }

    tracing::info!(
        key = ?key,
        topic = message.topic(),
        partition = message.partition(),
        offset = message.offset(),
        "processed"
    );

    Outcome::Commit
}

/// Publish a labels event for `target` and persist what we created to the
/// moderation DB. Returns `Retry` on any failure (transient, persistence,
/// or a not-ready identity) so the label is never silently dropped.
async fn publish_labels(ctx: &Context, target: EventKey, labels: Vec<String>) -> Outcome {
    let signer = ctx.polycentric.public_key();
    let head = match repository::chain_head(
        &ctx.ro_db,
        collections::LABELS,
        ctx.polycentric.identity(),
        signer.key_type,
        &signer.key,
    )
    .await
    {
        Ok(head) => head,
        Err(e) => {
            tracing::warn!(error = %e, "chain_head error");
            return Outcome::Retry;
        }
    };

    match ctx
        .polycentric
        .publish_labels(target.clone(), labels.clone(), head)
        .await
    {
        Ok(created) => match repository::persist_created(&ctx.db, &created).await {
            Ok(()) => {
                tracing::info!(key = ?target, labels = ?labels, "labels published");
                let meter = opentelemetry::global::meter("moderation");
                for label in &labels {
                    meter
                        .u64_counter("moderation_labels_published")
                        .build()
                        .add(1, &[opentelemetry::KeyValue::new("label", label.clone())]);
                }
                Outcome::Commit
            }
            Err(e) => {
                tracing::warn!(error = %e, "persist_created error");
                Outcome::Retry
            }
        },
        Err(PublishError::NotReady(e)) => {
            tracing::warn!(error = %e, "labels publish not ready, will retry");
            Outcome::Retry
        }
        Err(PublishError::Transient(e)) => {
            tracing::warn!(error = %e, "labels publish failed");
            Outcome::Retry
        }
    }
}

/// If processing a report from a moderator that corresponds to a label,
/// publish that label.
async fn process_moderator_report(
    ctx: &Context,
    author_identity: &str,
    report: &Report,
) -> Outcome {
    match repository::is_moderator(&ctx.ro_db, author_identity).await {
        Ok(true) => {}
        Ok(false) => {
            tracing::debug!(author = author_identity, "report author is not a moderator");
            return Outcome::Commit;
        }
        Err(e) => {
            tracing::warn!(error = %e, author = author_identity, "is_moderator error");
            return Outcome::Retry;
        }
    }

    let Some(label) = labels::label_from_report_category(report.category) else {
        tracing::debug!(
            category = report.category,
            "report category has no label counterpart"
        );
        return Outcome::Commit;
    };

    let Some(target) = report.event_key.clone() else {
        tracing::warn!("moderator report missing event_key");
        return Outcome::Commit;
    };

    let labels = vec![label.value().to_string()];
    let digest = polycentric::labels_content(&target, &labels).1;
    match repository::created_content_exists(&ctx.ro_db, digest.r#type, digest.value).await {
        Ok(true) => {
            tracing::debug!(key = ?target, "labels event already created, skipping");
            Outcome::Commit
        }
        Ok(false) => publish_labels(ctx, target, labels).await,
        Err(e) => {
            tracing::warn!(error = %e, "created_content_exists error");
            Outcome::Retry
        }
    }
}

/// Ensure a CHILD_SAFETY report event exists for CSAM `key`. The report records
/// and propagates the violation, but images should be purged before this runs.
async fn report_csam(ctx: &Context, key: &Option<EventKey>) {
    let Some(target) = key.clone() else {
        tracing::error!("cannot report CSAM: message had no decodable event key");
        return;
    };

    // Check if the report already exists
    let additional_info = "PhotoDNA service reported image as CSAM";
    let (_, digest) =
        polycentric::report_content(&target, ReportCategory::ChildSafety, additional_info);
    match repository::created_content_exists(&ctx.ro_db, digest.r#type, digest.value).await {
        Ok(true) => {
            tracing::info!(key = ?key, "CSAM report already created, skipping");
            return;
        }
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error = %e, key = ?key, "created_content_exists error, skipping report");
            return;
        }
    }

    let signer = ctx.polycentric.public_key();
    let head = match repository::chain_head(
        &ctx.ro_db,
        collections::REPORTS,
        ctx.polycentric.identity(),
        signer.key_type,
        &signer.key,
    )
    .await
    {
        Ok(head) => head,
        Err(e) => {
            tracing::error!(error = %e, key = ?key, "chain_head error, skipping report");
            return;
        }
    };

    match ctx
        .polycentric
        .publish_report(
            target.clone(),
            ReportCategory::ChildSafety,
            additional_info.to_string(),
            head,
        )
        .await
    {
        Ok(created) => {
            if let Err(e) = repository::persist_created(&ctx.db, &created).await {
                tracing::warn!(error = %e, key = ?key, "persist_created error");
            }
            // TODO: report confirmed CSAM to authorities (PhotoDNA? NCMEC?)
        }
        Err(PublishError::NotReady(e)) => {
            tracing::error!(error = %e, key = ?key, "report publish not ready, skipping");
        }
        Err(PublishError::Transient(e)) => {
            tracing::error!(error = %e, key = ?key, "report publish failed, skipping");
        }
    }
}
