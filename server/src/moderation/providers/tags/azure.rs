use super::interface::{ModerationTaggingProvider, ModerationTaggingResult};
use crate::{
    config::Config, model::moderation_tag::ModerationTag,
    moderation::moderation_queue::ModerationQueueItem,
};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum MediaType {
    Text = 1,
    Image = 2,
    ImageWithText = 3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Hash, Eq, PartialEq)]
pub enum Category {
    Hate = 1,
    SelfHarm = 2,
    Sexual = 3,
    Violence = 4,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Action {
    Accept = 1,
    Reject = 2,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectionException {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for DetectionException {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DetectionException: {} - {}", self.code, self.message)
    }
}

impl std::error::Error for DetectionException {}

#[derive(Debug, Serialize, Deserialize)]
pub struct Decision {
    pub suggested_action: Action,
    pub action_by_category: HashMap<Category, Action>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Image {
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DetectionRequest {
    Image {
        image: Image,
    },
    Text {
        text: String,
        blocklist_names: Vec<String>,
    },
    ImageWithText {
        text: String,
        enable_ocr: bool,
        image: Image,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CategoriesAnalysis {
    pub category: Option<Category>,
    pub severity: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectionResult {
    pub categories_analysis: Option<Vec<CategoriesAnalysis>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlocklistDetailedResult {
    pub blocklist_name: Option<String>,
    pub block_item_id: Option<String>,
    pub block_item_text: Option<String>,
    pub offset: Option<i32>,
    pub length: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TextDetectionResult {
    #[serde(flatten)]
    pub base: DetectionResult,
    pub blocklists_match_results: Option<Vec<BlocklistDetailedResult>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectionErrorResponse {
    pub error: DetectionError,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectionError {
    pub code: Option<String>,
    pub message: Option<String>,
    pub target: Option<String>,
    pub details: Option<Vec<String>>,
    pub innererror: Option<DetectionInnerError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectionInnerError {
    pub code: Option<String>,
    pub innererror: Option<String>,
}

pub struct ContentSafety {
    endpoint: String,
    subscription_key: String,
    api_version: String,
    client: Client,
}

impl ContentSafety {
    pub fn new(
        endpoint: String,
        subscription_key: String,
        api_version: String,
    ) -> Self {
        ContentSafety {
            endpoint,
            subscription_key,
            api_version,
            client: Client::new(),
        }
    }

    fn build_url(&self, media_type: MediaType) -> String {
        match media_type {
            MediaType::Text => format!(
                "{}/contentsafety/text:analyze?api-version={}",
                self.endpoint, self.api_version
            ),
            MediaType::Image => format!(
                "{}/contentsafety/image:analyze?api-version={}",
                self.endpoint, self.api_version
            ),
            MediaType::ImageWithText => format!(
                "{}/contentsafety/imageWithText:analyze?api-version={}",
                self.endpoint, self.api_version
            ),
        }
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

    fn build_request_body(
        &self,
        media_type: MediaType,
        text_content: &Option<String>,
        image_content: &Option<Vec<u8>>,
        blocklists: &Option<Vec<String>>,
        enable_ocr: bool,
    ) -> DetectionRequest {
        match media_type {
            MediaType::Text => DetectionRequest::Text {
                text: text_content.as_ref().unwrap().to_string(),
                blocklist_names: blocklists.clone().unwrap_or_default(),
            },
            MediaType::Image => DetectionRequest::Image {
                image: Image {
                    content: ::base64::encode(image_content.as_ref().unwrap()),
                },
            },
            MediaType::ImageWithText => DetectionRequest::ImageWithText {
                image: Image {
                    content: ::base64::encode(image_content.as_ref().unwrap()),
                },
                text: text_content.as_ref().unwrap().to_string(),
                enable_ocr,
            },
        }
    }

    pub async fn detect(
        &self,
        media_type: MediaType,
        text_content: &Option<String>,
        image_content: &Option<Vec<u8>>,
        enable_ocr: bool,
        blocklists: &Option<Vec<String>>,
    ) -> ::anyhow::Result<DetectionResult> {
        let url = self.build_url(media_type);
        let headers = self.build_headers();
        let request_body = self.build_request_body(
            media_type,
            text_content,
            image_content,
            blocklists,
            enable_ocr,
        );

        let response = self
            .client
            .post(&url)
            .headers((&headers).try_into()?)
            .body(serde_json::to_string(&request_body)?)
            .send()
            .await?;

        if response.status().is_success() {
            let body = response.text().await?;
            let result: DetectionResult = serde_json::from_str(&body)?;
            Ok(result)
        } else {
            let body = response.text().await?;
            let error: DetectionErrorResponse = serde_json::from_str(&body)?;
            Err(anyhow::anyhow!("Detection error: {:?}", error))
        }
    }
}

pub struct AzureTagProvider {
    content_safety: Option<ContentSafety>,
}

impl AzureTagProvider {
    pub fn new() -> Self {
        AzureTagProvider {
            content_safety: None,
        }
    }
}

#[async_trait]
impl ModerationTaggingProvider for AzureTagProvider {
    async fn init(&mut self, config: &Config) -> anyhow::Result<()> {
        let endpoint = config.azure_tagging_endpoint.clone();
        let subscription_key = config.azure_tagging_subscription_key.clone();
        let api_version = config.azure_tagging_api_version.clone();
        self.content_safety =
            Some(ContentSafety::new(endpoint, subscription_key, api_version));
        Ok(())
    }

    async fn moderate(
        &self,
        event: &ModerationQueueItem,
    ) -> ::anyhow::Result<ModerationTaggingResult> {
        if self.content_safety.is_none() {
            return Err(anyhow::anyhow!("ContentSafety not initialized"));
        }

        let detector = self.content_safety.as_ref().unwrap();

        let media_type = match (event.content.is_some(), event.blob.is_some()) {
            (true, false) => MediaType::Text,
            (false, true) => MediaType::Image,
            (true, true) => MediaType::ImageWithText,
            _ => {
                return Err(anyhow::anyhow!("No content or blob"));
            }
        };

        let result = detector
            .detect(media_type, &event.content, &event.blob, true, &None)
            .await;

        // Always return ok, error is handled in the moderation queue
        match result {
            Ok(result) => match result.categories_analysis {
                Some(categories_analysis) => Ok(ModerationTaggingResult {
                    tags: categories_analysis
                        .iter()
                        .map(|category| {
                            ModerationTag::new(
                                match category.category.unwrap() {
                                    Category::Hate => "hate".to_string(),
                                    Category::SelfHarm => {
                                        "self_harm".to_string()
                                    }
                                    Category::Sexual => "sexual".to_string(),
                                    Category::Violence => {
                                        "violence".to_string()
                                    }
                                },
                                category.severity.unwrap() as i16,
                            )
                        })
                        .collect(),
                }),
                None => Err(anyhow::anyhow!("No detection result")),
            },
            Err(e) => Err(anyhow::anyhow!("Error detecting content: {}", e)),
        }
    }
}