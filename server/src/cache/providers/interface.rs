use ::anyhow::Result;

#[async_trait::async_trait]
pub(crate) trait CacheProvider: Send + Sync {
    async fn purge_tags(&self, tags: &[String]) -> Result<()>;
    fn get_header_name(&self) -> &str;
    fn get_header_value(&self, tags: &[String]) -> String;
}
