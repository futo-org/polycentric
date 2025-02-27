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

        // Varnish with xkey module accepts tag purging via:
        // PURGE / with Surrogate-Key header
        let tags_str = self.get_header_value(tags);
        let url = format!("{}/", self.base_url);

        ::log::debug!("Purging tags: {}", tags_str);
        let method = Method::from_bytes(b"PURGE").unwrap();
        let response = self
            .client
            .request(method, &url)
            .header("xkey-purge", tags_str)
            .send()
            .await;

        if let Err(e) = response {
            ::log::error!("Error purging tags: {:?}", e);
            ::log::error!("Error purging tags: {}", e.to_string());
            return Ok(());
        }

        let response = response.unwrap();
        if !response.status().is_success() {
            // Check if we got a 403 Forbidden, which likely means we're not allowed to access the cache API
            if response.status() == reqwest::StatusCode::FORBIDDEN {
                ::log::error!("Access to Varnish purge API is forbidden. Please check your Varnish configuration to ensure the server has access to the purge API.");
            }

            ::log::error!(
                "Varnish purge API returned error: {} - {}",
                response.status(),
                response.text().await?
            );
        } else {
            ::log::debug!(
                "Successfully purged tags: {}",
                response.text().await?
            );
        }
        Ok(())
    }

    fn get_header_name(&self) -> &str {
        "xkey"
    }

    fn get_header_value(&self, tags: &[String]) -> String {
        tags.join(" ")
    }
}
