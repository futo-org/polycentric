//! Lightweight health-probe binary for container health checks.
//!
//! Behaviour:
//!   • Performs a single HTTP GET request to /health (or a custom path).
//!   • Prints the HTTP status code or any error to stdout/stderr for visibility.
//!   • Exits with code 0 if the status is 200, otherwise exits 1.
//!
//! Environment variables (optional):
//!   HTTP_PORT_API   — Port to query (default: 8081)
//!   HOST            — Hostname (default: localhost)
//!   HEALTH_PATH     — Path to query (default: /health)
//!
//! Example Docker HEALTHCHECK:
//!   HEALTHCHECK CMD ["/usr/local/bin/health_probe"]
//!
//! This binary relies only on `reqwest` (already in the dependencies).

use std::{env, process::exit, time::Duration};

#[tokio::main]
async fn main() {
    let port = env::var("HTTP_PORT_API").unwrap_or_else(|_| "8081".into());
    let host = env::var("HOST").unwrap_or_else(|_| "localhost".into());
    let path = env::var("HEALTH_PATH").unwrap_or_else(|_| "/health".into());

    let url = format!("http://{host}:{port}{path}");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .expect("failed to build client");

    match client
        .get(&url)
        .header("Custom-Header", "healthcheck")
        .send()
        .await
    {
        Ok(resp) if resp.status() == 200 => {
            println!("Health OK: {}", resp.status());
            exit(0);
        }
        Ok(resp) => {
            eprintln!("Unhealthy: {}", resp.status());
            exit(1);
        }
        Err(err) => {
            eprintln!("Request error: {err}");
            exit(1);
        }
    }
}
