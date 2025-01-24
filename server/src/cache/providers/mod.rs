pub(crate) mod cloudflare;

use crate::config::Config;
use ::anyhow::Result;

pub(crate) fn make_provider(
    config: &Config,
) -> Result<Option<Box<dyn super::CacheProvider>>> {
    match &config.cache_interface {
        Some(interface) => match interface.as_str() {
            "cloudflare" => {
                if let (Some(zone_id), Some(auth_token)) =
                    (&config.cloudflare_zone_id, &config.cloudflare_auth_token)
                {
                    Ok(Some(Box::new(cloudflare::CloudflareProvider::new(
                        zone_id.clone(),
                        auth_token.clone(),
                    ))))
                } else {
                    Err(anyhow::anyhow!(
                        "Missing cloudflare cache interface configuration"
                    ))
                }
            }
            _ => Err(anyhow::anyhow!("Unknown cache interface: {}", interface)),
        },
        None => Ok(None),
    }
}
