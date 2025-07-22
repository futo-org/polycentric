// forum_server/src/handlers/mod.rs
pub mod board_handlers;
pub mod category_handlers;
pub mod post_handlers;
pub mod thread_handlers;
pub mod user_handlers;

use crate::AppState;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;

#[derive(Serialize)]
pub struct ServerInfoResponse {
    name: String,
    #[serde(rename = "imageUrl")]
    image_url: Option<String>,
    #[serde(rename = "imageUploadsEnabled")]
    image_uploads_enabled: bool,
}

pub async fn get_server_info_handler(State(state): State<AppState>) -> impl IntoResponse {
    let response = ServerInfoResponse {
        name: state.config.name.clone(),
        image_url: state.config.image_url.clone(),
        image_uploads_enabled: state.image_uploads_enabled,
    };

    (StatusCode::OK, Json(response))
}
