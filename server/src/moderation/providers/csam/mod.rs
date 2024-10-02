use crate::config::Config;

use self::interface::ModerationCSAMProvider;
pub mod interface;

pub mod photodna;

pub async fn make_provider(
    config: &Config,
) -> ::anyhow::Result<Box<dyn ModerationCSAMProvider>> {
    match &config.csam_interface {
        Some(interface) => {
            let mut provider = match interface.as_str() {
                "photodna" => Box::new(photodna::PhotoDNAProvider::new()),
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
        None => Err(anyhow::anyhow!("CSAM interface not set")),
    }
}
