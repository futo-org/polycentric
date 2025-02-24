use crate::cache::providers::interface;
use anyhow::Result;
use reqwest::Client;

pub(crate) struct CaddyProvider {
    client: Client,
    base_url: String,
}

impl CaddyProvider {
    pub fn new(base_url: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
        }
    }
}

#[async_trait::async_trait]
impl interface::CacheProvider for CaddyProvider {
    async fn purge_tags(&self, tags: &[String]) -> Result<()> {
        if tags.is_empty() {
            return Ok(());
        }

        // Caddy's cache API expects tags in the query parameter
        let tags_str = tags.join(",");
        let url = format!("{}/cache-api/tags?tags={}", self.base_url, tags_str);

        let response = self
            .client
            .delete(&url)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "Caddy cache API returned error: {} - {}",
                response.status(),
                response.text().await?
            ));
        }
        Ok(())
    }
} 