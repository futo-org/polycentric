mod config;
mod context;
mod db;
mod expo_client;
mod manager;
mod polycentric;
mod render;
mod repository;
mod rpc;
#[cfg(test)]
mod testing;

use context::Context;
use manager::NotificationManager;
use polycentric::PolycentricClient;

use tracing::{info, warn};

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use common_kafka::{BorrowedMessage, CommitMode, Consumer, Headers, Message, Offset};
use polycentric_common::models::protos_v2::Notification;
use prost::Message as _;
use tonic::transport::Server;

/// Duration before retrying a Retry event.
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load .env before anything reads the environment.
    common_dotenv::load(".env");
    let config = config::init()?;

    common_telemetry::init();
    common_telemetry::init_metrics("push-notifications");

    // Shared connection, then run migrations on every load.
    let (db, ro_db) = db::connect().await?;
    db::run_migrations(&db).await?;

    let notification_manager = NotificationManager::new(config.expo_access_token.clone());

    let polycentric = PolycentricClient::new(config.query_servers.clone());

    let ctx = Arc::new(Context {
        db,
        ro_db,
        notification_manager,
        polycentric,
        main_server: config.main_server.clone(),
    });

    // Serve gRPC and consume Kafka concurrently. If either future returns,
    // the process exits (and is restarted by the supervisor).
    tokio::select! {
        result = serve_grpc(ctx.clone(), config.grpc_addr) => {
            if let Err(e) = result {
                warn!("gRPC server exited: {}", e);
            }
        }
        _ = run_consumer(ctx) => {}
    }

    Ok(())
}

/// Serve the gRPC `NotificationService` (push-token register/unregister).
async fn serve_grpc(ctx: Arc<Context>, addr: SocketAddr) -> Result<(), tonic::transport::Error> {
    info!("NotificationService gRPC listening on {addr}");
    Server::builder()
        .add_service(rpc::build_notification_service(ctx))
        .serve(addr)
        .await
}

/// Messages handled, by outcome (committed / retried / skipped).
static WORKER_MESSAGES: std::sync::LazyLock<opentelemetry::metrics::Counter<u64>> =
    std::sync::LazyLock::new(|| {
        opentelemetry::global::meter("push-notifications")
            .u64_counter("worker_messages")
            .build()
    });

fn count_message(outcome: &'static str) {
    WORKER_MESSAGES.add(
        1,
        &[
            opentelemetry::KeyValue::new("group", "push-notifications"),
            opentelemetry::KeyValue::new("outcome", outcome),
        ],
    );
}

/// Consume the `notifications` Kafka topic and drive push processing.
async fn run_consumer(ctx: Arc<Context>) {
    // Listen to the materialized notifications produced by the server.
    let consumer = common_kafka::build_consumer("push-notifications", &["notifications"]).await;

    // Failure counts for messages currently being retried.
    let mut attempts: HashMap<(i32, i64), u32> = HashMap::new();

    loop {
        let message = match consumer.recv().await {
            Ok(message) => message,
            Err(e) => {
                warn!("Kafka error: {}", e);
                continue;
            }
        };

        let coord = (message.partition(), message.offset());

        match process(&ctx, &message).await {
            Outcome::Commit => {
                attempts.remove(&coord);
                count_message("committed");
                if let Err(e) = consumer.commit_message(&message, CommitMode::Async) {
                    warn!("failed to commit offset: {}", e);
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
                    warn!(
                        "message at partition {} offset {} failed {} times; skipping",
                        coord.0, coord.1, failures
                    );
                    attempts.remove(&coord);
                    if let Err(e) = consumer.commit_message(&message, CommitMode::Async) {
                        warn!("failed to commit offset after skip: {}", e);
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
                        warn!("failed to seek for retry: {}", e);
                    }
                    tokio::time::sleep(RETRY_BACKOFF).await;
                }
            }
        }
    }
}

/// Handle a single consumed message.
async fn process(ctx: &Context, message: &BorrowedMessage<'_>) -> Outcome {
    // Only notifications published by the main server should fire pushes.
    // Skip (commit past) anything from another source.
    let source_server = message
        .headers()
        .and_then(|headers| headers.iter().find(|h| h.key == "SOURCE_SERVER"))
        .and_then(|header| header.value);
    if source_server != Some(ctx.main_server.as_bytes()) {
        return Outcome::Commit;
    }

    let notification = match message.payload() {
        Some(bytes) => match Notification::decode(bytes) {
            Ok(n) => n,
            Err(e) => {
                warn!("failed to decode Notification: {:?}", e);
                return Outcome::Commit;
            }
        },
        None => return Outcome::Commit,
    };

    // The worker keys each message by the notification's recipient.
    let Some(to_identity) = message
        .key()
        .and_then(|key| std::str::from_utf8(key).ok())
        .filter(|identity| !identity.is_empty())
    else {
        return Outcome::Commit;
    };

    match ctx
        .notification_manager
        .process_notification(ctx, to_identity, &notification)
        .await
    {
        Ok(_) => Outcome::Commit,
        Err(e) => {
            warn!("Push notification processing error: {}", e);
            Outcome::Retry
        }
    }
}
