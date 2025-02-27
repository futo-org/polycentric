use crate::cache::providers::interface;
use anyhow::Result;
use reqwest::{Client, Method};

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

        // The Caddy Souin cache plugin accepts tag purging via:
        // DELETE /cache-api/tags?tags=tag1,tag2
        let tags_str = tags.join(",");
        let url = format!("{}/cache-api", self.base_url);

        ::log::debug!("Purging tags: {}", tags_str);
        let method = Method::from_bytes(b"PURGE").unwrap();
        let response = self
            .client
            .request(method, &url)
            .header("Surrogate-Key", tags_str)
            .send()
            .await;

        if let Err(e) = response {
            ::log::error!("Error purging tags: {:?}", e.status());
            ::log::error!("Error purging tags: {}", e.to_string());
            return Ok(());
        }

        let response = response.unwrap();
        if !response.status().is_success() {
            // Check if we got a 403 Forbidden, which likely means we're not allowed to access the cache API
            if response.status() == reqwest::StatusCode::FORBIDDEN {
                ::log::error!("Access to Caddy cache API is forbidden. Please check your Caddy configuration to ensure the server has access to the cache API.");
            }

            ::log::error!(
                "Caddy cache API returned error: {} - {}",
                response.status(),
                response.text().await?
            );
        } else {
            ::log::debug!("Successfully purged tags");
        }
        Ok(())
    }

    fn get_header_name(&self) -> &str {
        "Surrogate-Key"
    }

    fn get_header_value(&self, tags: &[String]) -> String {
        tags.join(",")
    }
}
