use rdkafka::client::ClientContext;
use rdkafka::config::{ClientConfig, RDKafkaLogLevel};
use rdkafka::consumer::ConsumerContext;
use rdkafka::consumer::stream_consumer::StreamConsumer;
use rdkafka::error::KafkaError;

pub use rdkafka::consumer::{CommitMode, Consumer};

use crate::config::{auto_offset_reset, max_poll_interval_ms, prefixed, set_defaults};

pub struct CustomContext;

// Forward librdkafka's events into tracing; the default context drops them.
impl ClientContext for CustomContext {
    fn log(&self, level: RDKafkaLogLevel, fac: &str, log_message: &str) {
        match level {
            RDKafkaLogLevel::Emerg
            | RDKafkaLogLevel::Alert
            | RDKafkaLogLevel::Critical
            | RDKafkaLogLevel::Error => {
                tracing::error!(target: "rdkafka", fac, "{log_message}")
            }
            RDKafkaLogLevel::Warning => {
                tracing::warn!(target: "rdkafka", fac, "{log_message}")
            }
            RDKafkaLogLevel::Notice | RDKafkaLogLevel::Info => {
                tracing::info!(target: "rdkafka", fac, "{log_message}")
            }
            RDKafkaLogLevel::Debug => {
                tracing::debug!(target: "rdkafka", fac, "{log_message}")
            }
        }
    }

    fn error(&self, error: KafkaError, reason: &str) {
        tracing::error!(target: "rdkafka", %error, "{reason}");
    }
}

impl ConsumerContext for CustomContext {}

/// Build a subscribed `StreamConsumer` with auto-commit disabled. The group
/// id and topics are prefixed with the cluster id via [`prefixed`].
pub async fn build_consumer(group_id: &str, topics: &[&str]) -> StreamConsumer<CustomContext> {
    let mut config = ClientConfig::new();
    set_defaults(&mut config);
    config
        .set("group.id", prefixed(group_id))
        .set("enable.auto.commit", "false")
        .set("auto.offset.reset", auto_offset_reset())
        .set("max.poll.interval.ms", max_poll_interval_ms());

    let consumer: StreamConsumer<CustomContext> = config
        .create_with_context(CustomContext)
        .expect("Consumer creation failed");

    let topics: Vec<String> = topics.iter().map(|topic| prefixed(topic)).collect();
    consumer
        .subscribe(&topics.iter().map(String::as_str).collect::<Vec<_>>())
        .expect("Can't subscribe to specified topics");

    consumer
}
