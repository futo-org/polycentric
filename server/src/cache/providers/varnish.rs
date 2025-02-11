use crate::cache::providers::interface;
use anyhow::Result;
use reqwest::{Client, Method};
pub(crate) struct VarnishProvider {
    client: Client,
    base_url: String,
}

impl VarnishProvider {
    pub fn new(base_url: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
        }
    }
}

#[async_trait::async_trait]
impl interface::CacheProvider for VarnishProvider {
    async fn purge_tags(&self, tags: &[String]) -> Result<()> {
        if tags.is_empty() {
            return Ok(());
        }
        let x_key_header = tags.join(",");

        // Create a PURGE request. Using reqwest::Method::from_bytes to support PURGE.
        let purge_method = Method::from_bytes(b"PURGE")?;
        let response = self
            .client
            .request(purge_method, &self.base_url)
            .header("X-Key", &x_key_header)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "Varnish API returned error: {}",
                response.status()
            ));
        }
        Ok(())
    }
}
