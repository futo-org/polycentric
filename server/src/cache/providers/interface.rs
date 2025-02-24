use ::anyhow::Result;

#[async_trait::async_trait]
pub(crate) trait CacheProvider: Send + Sync {
    async fn purge_tags(&self, tags: &[String]) -> Result<()>;
}
