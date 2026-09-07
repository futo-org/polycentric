//! Shared structured-logging and metrics setup for the Rust services.

use std::io::IsTerminal;

use opentelemetry::KeyValue;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::metrics::SdkMeterProvider;
use prometheus::Encoder;
use tracing_subscriber::EnvFilter;

/// Initialize logging: `RUST_LOG` filters (default `info`), JSON to stdout
/// in deployments, human-readable text on a terminal. `LOG_FORMAT=json|text`
/// overrides the format. `log` macros are bridged into `tracing`.
pub fn init() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let json = match std::env::var("LOG_FORMAT").as_deref() {
        Ok("json") => true,
        Ok("text") => false,
        _ => !std::io::stdout().is_terminal(),
    };

    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if json {
        builder.json().flatten_event(true).init();
    } else {
        builder.init();
    }
}

/// Install a Prometheus-backed OpenTelemetry meter provider and serve
/// GET /metrics on 0.0.0.0:$METRICS_PORT (default 9464). Must be called
/// from within a tokio runtime.
pub fn init_metrics(service_name: &str) {
    let registry = prometheus::Registry::new();
    let exporter = opentelemetry_prometheus::exporter()
        .with_registry(registry.clone())
        .build()
        .expect("failed to build Prometheus exporter");
    let provider = SdkMeterProvider::builder()
        .with_reader(exporter)
        .with_resource(
            Resource::builder()
                .with_service_name(service_name.to_string())
                .build(),
        )
        .build();
    opentelemetry::global::set_meter_provider(provider);

    let port: u16 = std::env::var("METRICS_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(9464);
    tokio::spawn(serve_metrics(registry, port));
}

/// Export the database pool's open connections (`db_pool_connections`,
/// by `state` = `idle` | `used`) and its configured ceiling
/// (`db_pool_max_connections`) as gauges sampled on every scrape. The
/// callbacks hold a pool handle for the life of the process.
pub fn observe_db_pool<DB: sqlx::Database>(meter_name: &'static str, pool: sqlx::Pool<DB>) {
    let meter = opentelemetry::global::meter(meter_name);
    let max = u64::from(pool.options().get_max_connections());
    meter
        .u64_observable_gauge("db_pool_max_connections")
        .with_callback(move |gauge| gauge.observe(max, &[]))
        .build();
    meter
        .u64_observable_gauge("db_pool_connections")
        .with_callback(move |gauge| {
            let size = u64::from(pool.size());
            let idle = pool.num_idle() as u64;
            gauge.observe(idle, &[KeyValue::new("state", "idle")]);
            gauge.observe(size.saturating_sub(idle), &[KeyValue::new("state", "used")]);
        })
        .build();
}

async fn serve_metrics(registry: prometheus::Registry, port: u16) {
    let app = axum::Router::new().route(
        "/metrics",
        axum::routing::get(move || {
            let registry = registry.clone();
            async move {
                let mut buf = Vec::new();
                if prometheus::TextEncoder::new()
                    .encode(&registry.gather(), &mut buf)
                    .is_err()
                {
                    buf.clear();
                }
                (
                    [(
                        axum::http::header::CONTENT_TYPE,
                        "text/plain; version=0.0.4",
                    )],
                    buf,
                )
            }
        }),
    );
    match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(listener) => {
            if let Err(e) = axum::serve(listener, app).await {
                tracing::error!(error = %e, "metrics server failed");
            }
        }
        Err(e) => tracing::error!(error = %e, port, "failed to bind metrics port"),
    }
}
