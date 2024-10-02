use crate::{
    config::Config, moderation::moderation_queue::ModerationQueueItem,
};
use async_trait::async_trait;

pub struct ModerationCSAMResult {
    pub is_csam: bool,
}

#[async_trait]
pub trait ModerationCSAMProvider: Send + Sync {
    async fn init(&mut self, config: &Config) -> anyhow::Result<()>;
    async fn moderate(
        &self,
        event: &ModerationQueueItem,
    ) -> anyhow::Result<ModerationCSAMResult>;
}
