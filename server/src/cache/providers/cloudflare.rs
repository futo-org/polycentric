use ::anyhow::Result;
use ::moka::future::Cache;
use ::reqwest::Client;
use ::serde::Serialize;
use futures::future::join_all;
use polycentric_protocol::model::{known_message_types, pointer, public_key};
use std::time::Duration;

pub(crate) struct CloudflareProvider {
    client: Client,
    zone_id: String,
    auth_token: String,
    // This is fast, but in the future could be done with a fancy expiring bloom filter
    cache: Cache<String, ()>,
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
            cache: Cache::builder()
                .max_capacity(10000)
                .time_to_live(Duration::from_secs(3600))
                .build(),
        }
    }
}

#[async_trait::async_trait]
impl super::super::interface::CacheProvider for CloudflareProvider {
    async fn purge_tags(&self, tags: &[String]) -> Result<()> {
        let tags_to_purge: Vec<String> = tags
            .iter()
            .filter(|tag| self.cache.contains_key(*tag))
            .cloned()
            .collect();

        if tags_to_purge.is_empty() {
            return Ok(());
        }

        tags_to_purge.iter().for_each(|tag| {
            // Not awaiting, should be done in the background
            self.cache.remove(tag);
        });

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
                tags: tags_to_purge,
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

    fn generate_cache_tags(
        &self,
        signed_event: &polycentric_protocol::model::signed_event::SignedEvent,
    ) -> Vec<String> {
        let event =
            polycentric_protocol::model::event::from_vec(signed_event.event());

        let mut out = Vec::new();
        if let Ok(event) = event {
            match *event.content_type() {
                // For posts and claims, the cache tag is the post id
                known_message_types::POST
                | known_message_types::DELETE
                | known_message_types::CLAIM
                | known_message_types::VOUCH => {
                    // {content_type}:{pkey} to invalidate the feeds
                    // {content_type}:{poin ter} to invalidate the post

                    let key_str = public_key::to_base64(event.system());

                    if let Ok(key_str) = key_str {
                        out.push(format!(
                            "{}:{}",
                            event.content_type(),
                            key_str
                        ));
                    }

                    let pointer = pointer::from_signed_event(signed_event);
                    if let Ok(pointer) = pointer {
                        let base64_pointer = pointer::to_base64(&pointer);
                        if let Ok(base64_pointer) = base64_pointer {
                            out.push(format!("post:{}", base64_pointer));
                        }
                    }
                }
                known_message_types::USERNAME
                | known_message_types::AVATAR
                | known_message_types::BANNER
                | known_message_types::DESCRIPTION
                | known_message_types::SERVER => {
                    // {content_type}:{pkey} to invalidate the user
                    let key_str = public_key::to_base64(event.system());
                    if let Ok(key_str) = key_str {
                        out.push(format!(
                            "{}:{}",
                            event.content_type(),
                            key_str
                        ));
                    }
                }
                _ => {}
            }
        }

        out
    }

    async fn activate_cache_tags(&self, tags: &[String]) -> Result<()> {
        join_all(tags.iter().map(|tag| self.cache.insert(tag.clone(), ())))
            .await;
        Ok(())
    }
}
