// forum_server/src/handlers/mod.rs
pub mod board_handlers;
pub mod category_handlers;
pub mod post_handlers;
pub mod thread_handlers;
pub mod user_handlers;

use crate::AppState;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;
use std::env;

#[derive(Serialize)]
pub struct ServerInfoResponse {
    name: String,
    #[serde(rename = "imageUrl")]
    image_url: Option<String>,
    #[serde(rename = "imageUploadsEnabled")]
    image_uploads_enabled: bool,
}

pub async fn get_server_info_handler(State(state): State<AppState>) -> impl IntoResponse {
    let server_name =
        env::var("FORUM_SERVER_NAME").unwrap_or_else(|_| "Default Forum Name".to_string());
    let image_url = env::var("FORUM_SERVER_IMAGE_URL").ok();

    let response = ServerInfoResponse {
        name: server_name,
        image_url,
        image_uploads_enabled: state.image_uploads_enabled,
    };

    (StatusCode::OK, Json(response))
}
