pub(crate) mod interface;
pub(crate) mod noop;
pub(crate) mod varnish;
use crate::config::Config;
use ::anyhow::Result;

pub(crate) fn make_provider(
    config: &Config,
) -> Result<Option<Box<dyn interface::CacheProvider>>> {
    match &config.cache_interface {
        Some(interface) => match interface.as_str() {
            "varnish" => {
                if let Some(varnish_base_url) = config.varnish_base_url.clone()
                {
                    Ok(Some(Box::new(varnish::VarnishProvider::new(
                        varnish_base_url,
                    ))))
                } else {
                    Err(anyhow::anyhow!(
                        "Missing varnish base URL configuration"
                    ))
                }
            }
            "noop" => {
                ::log::info!("No cache provider selected");
                Ok(Some(Box::new(noop::NoopProvider::new())))
            }
            _ => Err(anyhow::anyhow!("Unknown cache interface: {}", interface)),
        },
        None => Ok(None),
    }
}
