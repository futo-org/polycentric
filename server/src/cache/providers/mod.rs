pub(crate) mod interface;
pub(crate) mod noop;
pub(crate) mod varnish;

use crate::config::Config;
use anyhow::Result;

pub(crate) fn make_provider(
    config: &Config,
) -> Result<Box<dyn interface::CacheProvider>> {
    match &config.cache_interface {
        Some(interface) => match interface.as_str() {
            "varnish" => {
                if let Some(base_url) = config.cache_base_url.clone() {
                    Ok(Box::new(varnish::VarnishProvider::new(base_url)))
                } else {
                    Err(anyhow::anyhow!("Missing cache base URL configuration"))
                }
            }
            "noop" => {
                ::log::info!("No cache provider selected");
                Ok(Box::new(noop::NoopProvider))
            }
            _ => Err(anyhow::anyhow!("Unknown cache interface: {}", interface)),
        },
        None => Ok(Box::new(noop::NoopProvider)),
    }
}
