use ::anyhow::Result;

#[async_trait::async_trait]
pub(crate) trait CacheProvider: Send + Sync {
    async fn purge_tags(&self, tags: &[String]) -> Result<()>;
    fn generate_cache_tags(
        &self,
        signed_event: &polycentric_protocol::model::signed_event::SignedEvent,
    ) -> Vec<String>;
    async fn activate_cache_tags(&self, tags: &[String]) -> Result<()>;
}
