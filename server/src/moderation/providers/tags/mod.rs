use crate::config::Config;

use self::interface::ModerationTaggingProvider;
pub mod interface;

pub mod azure;

pub async fn make_provider(
    config: &Config,
) -> ::anyhow::Result<Box<dyn ModerationTaggingProvider>> {
    match &config.tag_interface {
        Some(interface) => {
            let mut provider = match interface.as_str() {
                "azure" => Box::new(azure::AzureTagProvider::new()),
                _ => {
                    return Err(anyhow::anyhow!(
                        "Unknown provider: {}",
                        interface
                    ))
                }
            };
            provider.init(config).await?;
            Ok(provider)
        }
        None => Err(anyhow::anyhow!("Tagging interface not set")),
    }
}
