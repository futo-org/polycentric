// forum_server/src/handlers/mod.rs
pub mod board_handlers;
pub mod category_handlers;
pub mod post_handlers;
pub mod thread_handlers;

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;
use std::env;

#[derive(Serialize)]
pub struct ServerInfoResponse {
    name: String,
    #[serde(rename = "imageUrl")]
    image_url: Option<String>,
}

pub async fn get_server_info_handler() -> impl IntoResponse {
    let server_name =
        env::var("FORUM_SERVER_NAME").unwrap_or_else(|_| "Default Forum Name".to_string());
    let image_url = env::var("FORUM_SERVER_IMAGE_URL").ok();

    let response = ServerInfoResponse {
        name: server_name,
        image_url,
    };

    (StatusCode::OK, Json(response))
}
