use super::interface::{ModerationTaggingProvider, ModerationTaggingResult};

use crate::{
    config::Config, model::moderation_tag::ModerationTag,
    moderation::moderation_queue::ModerationQueueItem,
};
use async_trait::async_trait;
use log::{debug, error, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json;
use std::{cmp, collections::HashMap};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum MediaType {
    Text = 1,
    Image = 2,
    ImageWithText = 3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Hash, Eq, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum Category {
    Hate,
    SelfHarm,
    Sexual,
    Violence,
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
#[serde(untagged)]
#[serde(rename_all = "camelCase")]
pub enum DetectionRequest {
    Image {
        image: Image,
    },
    Text {
        text: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        blocklist_names: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    ImageWithText {
        text: String,
        enable_ocr: bool,
        image: Image,
        categories: Vec<Category>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CategoriesAnalysis {
    pub category: Category,
    pub severity: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult {
    pub categories_analysis: Vec<CategoriesAnalysis>,
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
            MediaType::Text => {
                let text = text_content.as_ref().unwrap();

                // Defensive check: never send empty text
                if text.trim().is_empty() {
                    warn!("Attempting to send empty text to Azure - this should not happen");
                    return DetectionRequest::Text {
                        text: "".to_string(),
                        blocklist_names: blocklists.clone().unwrap_or_default(),
                    };
                }

                debug!("Building text request: text_len={}", text.len());
                DetectionRequest::Text {
                    text: text.to_string(),
                    blocklist_names: blocklists.clone().unwrap_or_default(),
                }
            }
            MediaType::Image => {
                let image_bytes = image_content.as_ref().unwrap();

                // Defensive check: never send empty images
                if image_bytes.is_empty() {
                    warn!("Attempting to send empty image to Azure - this should not happen");
                    return DetectionRequest::Text {
                        text: "".to_string(),
                        blocklist_names: blocklists.clone().unwrap_or_default(),
                    };
                }

                let base64_content = ::base64::encode(image_bytes);
                debug!(
                    "Building image request: image_bytes={}, base64_len={}",
                    image_bytes.len(),
                    base64_content.len()
                );

                DetectionRequest::Image {
                    image: Image {
                        content: base64_content,
                    },
                }
            }
            MediaType::ImageWithText => {
                let text = text_content.as_ref().unwrap();
                let image_bytes = image_content.as_ref().unwrap();

                // Defensive check: never send empty images
                if image_bytes.is_empty() {
                    warn!("Attempting to send empty image to Azure - this should not happen");
                    return DetectionRequest::Text {
                        text: text.to_string(),
                        blocklist_names: blocklists.clone().unwrap_or_default(),
                    };
                }

                let base64_content = ::base64::encode(image_bytes);
                debug!("Building image+text request: text_len={}, image_bytes={}, base64_len={}", 
                    text.len(), image_bytes.len(), base64_content.len());

                DetectionRequest::ImageWithText {
                    image: Image {
                        content: base64_content,
                    },
                    text: text.to_string(),
                    enable_ocr,
                    categories: vec![
                        Category::Hate,
                        Category::SelfHarm,
                        Category::Sexual,
                        Category::Violence,
                    ],
                }
            }
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

        let body_json = serde_json::to_string(&request_body)?;

        // Log request details for debugging
        debug!("Azure Content Safety request: media_type={:?}, text_len={}, image_len={}, url={}", 
            media_type,
            text_content.as_ref().map(|t| t.len()).unwrap_or(0),
            image_content.as_ref().map(|i| i.len()).unwrap_or(0),
            url
        );

        let response = self
            .client
            .post(&url)
            .headers((&headers).try_into()?)
            .body(body_json)
            .send()
            .await?;

        if response.status().is_success() {
            let body = response.text().await?;
            let result: DetectionResult = serde_json::from_str(&body)?;
            debug!("Azure Content Safety success: media_type={:?}", media_type);
            Ok(result)
        } else {
            let status = response.status();
            let body = response.text().await?;

            // Log detailed error information
            error!(
                "Azure Content Safety error: status={}, body={}",
                status, body
            );

            let error: DetectionErrorResponse = serde_json::from_str(&body)?;

            // Log specific error details for debugging
            if let Some(error_code) = &error.error.code {
                warn!(
                    "Azure Content Safety error: code={}, message={:?}",
                    error_code, error.error.message
                );
                // Handle specific error codes that indicate permanent failures
                match error_code.as_str() {
                    "InvalidImageFormat" | "InvalidImageSize"
                    | "NotSupportedImage" | "InvalidRequestBody" => {
                        // Permanent failures – do not retry
                        warn!(
                            "Permanent Azure error ({}) : {}",
                            error_code,
                            error.error.message.as_deref().unwrap_or("Unknown")
                        );
                        Err(anyhow::anyhow!(
                            "Permanent Azure error: {} - {}",
                            error_code,
                            error.error.message.as_deref().unwrap_or("Unknown")
                        ))
                    }
                    "InvalidRequest" => {
                        warn!(
                            "Invalid request details: {:?}",
                            error.error.details
                        );
                        Err(anyhow::anyhow!(
                            "Invalid request to Azure: {}",
                            error_code
                        ))
                    }
                    _ => {
                        // Other errors might be transient
                        Err(anyhow::anyhow!(
                            "Azure error: {} - {}",
                            error_code,
                            error.error.message.as_deref().unwrap_or("Unknown")
                        ))
                    }
                }
            } else {
                Err(anyhow::anyhow!(
                    "Azure error without code: {:?}",
                    error.error
                ))
            }
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
        if config.azure_tagging_endpoint.is_none() {
            return Err(anyhow::anyhow!("Azure tagging endpoint not set"));
        }
        if config.azure_tagging_subscription_key.is_none() {
            return Err(anyhow::anyhow!(
                "Azure tagging subscription key not set"
            ));
        }
        if config.azure_tagging_api_version.is_none() {
            return Err(anyhow::anyhow!("Azure tagging API version not set"));
        }
        let endpoint = config.azure_tagging_endpoint.clone().unwrap();
        let subscription_key =
            config.azure_tagging_subscription_key.clone().unwrap();
        let api_version = config.azure_tagging_api_version.clone().unwrap();
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

        // Log event details for debugging
        debug!("Processing moderation event: id={}, has_content={}, has_blobs={}, content_len={}, blobs_count={}", 
            event.id,
            event.content.is_some(),
            !event.blobs.is_empty(),
            event.content.as_ref().map(|c| c.len()).unwrap_or(0),
            event.blobs.len()
        );

        // Guard: Azure returns 400 for text longer than 10 000 characters.
        if let Some(content) = &event.content {
            if content.len() > 10_000 {
                warn!(
                    "Skipping event {} - text too long ({} chars)",
                    event.id,
                    content.len()
                );
                return Ok(ModerationTaggingResult { tags: vec![] });
            }
        }

        // Validate that we have actual content to process
        let has_text = event.content.is_some()
            && !event.content.as_ref().unwrap().trim().is_empty();

        let has_images = !event.blobs.is_empty()
            && event.blobs.iter().any(|blob| !blob.blob.is_empty());

        if !has_text && !has_images {
            debug!("Skipping event {} - no valid content or blobs", event.id);
            return Ok(ModerationTaggingResult { tags: vec![] });
        }

        let media_type = match (has_text, has_images) {
            (true, false) => MediaType::Text,
            (false, true) => MediaType::Image,
            (true, true) => MediaType::ImageWithText,
            _ => {
                debug!(
                    "Skipping event {} - invalid content combination",
                    event.id
                );
                return Ok(ModerationTaggingResult { tags: vec![] });
            }
        };

        debug!(
            "Sending event {} to Azure: media_type={:?}",
            event.id, media_type
        );

        // Process each image separately (or a single None for text-only)
        let blob_inputs: Vec<Option<Vec<u8>>> = if event.blobs.is_empty() {
            vec![None]
        } else {
            event.blobs.iter().map(|b| Some(b.blob.clone())).collect()
        };

        let mut results: Vec<DetectionResult> = vec![];
        for blob in blob_inputs {
            let result = detector
                .detect(media_type, &event.content, &blob, true, &None)
                .await;

            match result {
                Ok(res) => results.push(res),
                Err(e) => {
                    error!(
                        "Azure processing failed for event {}: {}",
                        event.id, e
                    );
                    return Err(anyhow::anyhow!(
                        "Error detecting content: {}",
                        e
                    ));
                }
            }
        }

        // Combine results from all images by taking the maximum severity for each category
        let mut max_hate_level = 0;
        let mut max_sexual_level = 0;
        let mut max_violence_level = 0;
        let mut max_self_harm_level = 0;

        for result in results {
            let hate_result = result
                .categories_analysis
                .iter()
                .find(|category| category.category == Category::Hate);
            let sexual_result = result
                .categories_analysis
                .iter()
                .find(|category| category.category == Category::Sexual);
            let violence_result = result
                .categories_analysis
                .iter()
                .find(|category| category.category == Category::Violence);
            let self_harm_result = result
                .categories_analysis
                .iter()
                .find(|category| category.category == Category::SelfHarm);

            let (hate_level, sexual_level, violence_level, self_harm_level) =
                match (
                    hate_result,
                    sexual_result,
                    violence_result,
                    self_harm_result,
                ) {
                    (
                        Some(hate),
                        Some(sexual),
                        Some(violence),
                        Some(self_harm),
                    ) => (
                        hate.severity as i16 / 2,
                        sexual.severity as i16 / 2,
                        violence.severity as i16 / 2,
                        self_harm.severity as i16 / 2,
                    ),
                    _ => (0, 0, 0, 0),
                };

            max_hate_level = cmp::max(max_hate_level, hate_level);
            max_sexual_level = cmp::max(max_sexual_level, sexual_level);
            max_violence_level = cmp::max(max_violence_level, violence_level);
            max_self_harm_level =
                cmp::max(max_self_harm_level, self_harm_level);
        }

        debug!("Azure processing successful for event {}", event.id);

        let tags = vec![
            ModerationTag::new("hate".to_string(), max_hate_level),
            ModerationTag::new("sexual".to_string(), max_sexual_level),
            ModerationTag::new(
                "violence".to_string(),
                cmp::max(max_violence_level, max_self_harm_level),
            ),
        ];

        Ok(ModerationTaggingResult { tags })
    }
}
