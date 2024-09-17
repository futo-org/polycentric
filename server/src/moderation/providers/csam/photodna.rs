use super::interface::{ModerationCSAMProvider, ModerationCSAMResult};
use crate::{
    config::Config, moderation::moderation_queue::ModerationQueueItem,
};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoDNAMatchRequest {
    #[serde(rename = "DataRepresentation")]
    pub data_representation: String,
    #[serde(rename = "Value")]
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoDNAMatchResponse {
    #[serde(rename = "Status")]
    pub status: Status,
    #[serde(rename = "IsMatch")]
    pub is_match: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Status {
    #[serde(rename = "Code")]
    pub code: i32,
    #[serde(rename = "Description")]
    pub description: String,
}

pub struct PhotoDNA {
    endpoint: String,
    subscription_key: String,
    client: Client,
    enhance: bool,
}

impl PhotoDNA {
    pub fn new(subscription_key: String, enhance: bool) -> Self {
        PhotoDNA {
            endpoint: "https://api.microsoftmoderator.com/photodna/v1.0"
                .to_string(),
            subscription_key,
            client: Client::new(),
            enhance,
        }
    }

    fn build_url(&self) -> String {
        format!("{}/Match?enhance={}", self.endpoint, self.enhance)
    }

    fn build_headers(&self) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        headers.insert(
            "Ocp-Apim-Subscription-Key".to_string(),
            self.subscription_key.clone(),
        );
        headers
            .insert("Content-Type".to_string(), "application/json".to_string());
        headers
    }

    async fn detect(
        &self,
        image_blob: &[u8],
    ) -> anyhow::Result<PhotoDNAMatchResponse> {
        let url = self.build_url();
        let headers = self.build_headers();
        let request_body = PhotoDNAMatchRequest {
            data_representation: "Binary".to_string(),
            value: base64::encode(image_blob),
        };

        let response = self
            .client
            .post(&url)
            .headers((&headers).try_into()?)
            .body(serde_json::to_string(&request_body)?)
            .send()
            .await?;

        if response.status().is_success() {
            let body = response.text().await?;
            let result: PhotoDNAMatchResponse = serde_json::from_str(&body)?;
            Ok(result)
        } else {
            let body = response.text().await?;
            Err(anyhow::anyhow!("Detection error: {}", body))
        }
    }
}

pub struct PhotoDNAProvider {
    photo_dna: Option<PhotoDNA>,
}

impl PhotoDNAProvider {
    pub fn new() -> Self {
        PhotoDNAProvider { photo_dna: None }
    }
}

#[async_trait]
impl ModerationCSAMProvider for PhotoDNAProvider {
    async fn init(&mut self, config: &Config) -> anyhow::Result<()> {
        let photo_dna = PhotoDNA::new(config.photodna_key.clone(), true);
        self.photo_dna = Some(photo_dna);
        Ok(())
    }

    async fn moderate(
        &self,
        event: &ModerationQueueItem,
    ) -> anyhow::Result<ModerationCSAMResult> {
        if self.photo_dna.is_none() {
            return Err(anyhow::anyhow!("PhotoDNA is not initialized"));
        }

        let image_blob = event.blob.as_ref().ok_or_else(|| {
            anyhow::anyhow!("No image blob provided in the event")
        })?;

        let result =
            self.photo_dna.as_ref().unwrap().detect(image_blob).await?;

        Ok(ModerationCSAMResult {
            is_csam: result.is_match,
        })
    }
}
