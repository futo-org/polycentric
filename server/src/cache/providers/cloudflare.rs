use ::anyhow::Result;
use ::reqwest::Client;
use ::serde::Serialize;

pub(crate) struct CloudflareProvider {
    client: Client,
    zone_id: String,
    auth_token: String,
}

#[derive(Serialize)]
struct PurgeRequest {
    tags: Vec<String>,
}

impl CloudflareProvider {
    pub(crate) fn new(zone_id: String, auth_token: String) -> Self {
        Self {
            client: Client::new(),
            zone_id,
            auth_token,
        }
    }
}

#[async_trait::async_trait]
impl super::super::interface::CacheProvider for CloudflareProvider {
    async fn purge_tags(&self, tags: &[String]) -> Result<()> {
        let url = format!(
            "https://api.cloudflare.com/client/v4/zones/{}/purge_cache",
            self.zone_id
        );

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.auth_token))
            .header("Content-Type", "application/json")
            .body(serde_json::to_string(&PurgeRequest {
                tags: tags.to_vec(),
            })?)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(::anyhow::anyhow!(
                "Cloudflare API returned error: {}",
                response.status()
            ));
        }

        Ok(())
    }
}
