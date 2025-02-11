pub(crate) struct NoopProvider;
use crate::cache::providers::interface;

impl NoopProvider {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait::async_trait]
impl interface::CacheProvider for NoopProvider {
    async fn purge_tags(&self, _tags: &[String]) -> Result<(), anyhow::Error> {
        Ok(())
    }
}
