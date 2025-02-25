pub(crate) struct NoopProvider;
use crate::cache::providers::interface;

impl NoopProvider {}

#[async_trait::async_trait]
impl interface::CacheProvider for NoopProvider {
    async fn purge_tags(&self, _tags: &[String]) -> Result<(), anyhow::Error> {
        Ok(())
    }

    fn get_header_name(&self) -> &str {
        "No-Cache-Provider"
    }

    fn get_header_value(&self, _tags: &[String]) -> String {
        "No-Cache-Provider".to_string()
    }
}
