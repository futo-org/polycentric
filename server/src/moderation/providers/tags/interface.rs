use crate::{
    config::Config, model::moderation_tag::ModerationTag,
    moderation::moderation_queue::ModerationQueueItem,
};
use async_trait::async_trait;

pub struct ModerationTaggingResult {
    pub tags: Vec<ModerationTag>,
}

#[async_trait]
pub trait ModerationTaggingProvider: Send + Sync {
    async fn init(&mut self, config: &Config) -> anyhow::Result<()>;

    async fn moderate(
        &self,
        event: &ModerationQueueItem,
    ) -> anyhow::Result<ModerationTaggingResult>;
}
