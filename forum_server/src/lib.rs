use crate::auth::{check_admin_handler, get_challenge_handler, ChallengeStore};
use axum::{
    extract::State,
    http::Method,
    routing::{delete, get, post, put},
    Router,
};
use sqlx::PgPool;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::ServeDir;

pub mod auth;
pub mod constants;
pub mod handlers;
pub mod models;
pub mod repositories;
pub mod seeder;
pub mod storage;
pub mod utils;

use handlers::{
    board_handlers::{
        create_board_handler, delete_board_handler, get_board_handler,
        list_boards_in_category_handler, reorder_boards_handler, update_board_handler,
    },
    category_handlers::{
        create_category_handler, delete_category_handler, get_category_handler,
        list_categories_handler, reorder_categories_handler, update_category_handler,
    },
    get_server_info_handler,
    post_handlers::{
        create_post_handler, delete_post_handler, get_post_handler, link_polycentric_post_handler,
        list_posts_in_thread_handler, update_post_handler,
    },
    thread_handlers::{
        create_thread_handler, delete_thread_handler, get_thread_handler,
        list_threads_in_board_handler, update_thread_handler,
    },
    user_handlers::{
        ban_user_handler, check_ban_status_handler, get_all_users_handler,
        get_banned_users_handler, unban_user_handler,
    },
};

use storage::LocalImageStorage;

#[derive(Clone, axum::extract::FromRef)]
pub struct AppState {
    pub db_pool: PgPool,
    pub image_storage: LocalImageStorage,
    pub challenge_store: ChallengeStore,
    pub admin_pubkeys: Arc<HashSet<Vec<u8>>>,
    pub image_uploads_enabled: bool,
    pub config: crate::config::ForumServerConfig,
}

pub fn create_router(
    db_pool: PgPool,
    image_upload_dir: String,
    image_base_url: String,
    admin_pubkeys: Arc<HashSet<Vec<u8>>>,
    image_uploads_enabled: bool,
    config: crate::config::ForumServerConfig,
) -> Router {
    let image_storage = LocalImageStorage::new(image_upload_dir.clone(), image_base_url.clone());

    let challenge_store = ChallengeStore::new();

    let app_state = AppState {
        db_pool,
        image_storage: image_storage.clone(),
        challenge_store,
        admin_pubkeys,
        image_uploads_enabled,
        config: config.clone(),
    };

    let static_assets_dir = PathBuf::from("/app/static/images");
    let static_asset_service = ServeDir::new(static_assets_dir);
    let static_asset_base_url = "/static/images";

    let user_upload_dir = PathBuf::from(image_upload_dir);
    let user_upload_service = ServeDir::new(user_upload_dir);
    let user_upload_base_url = "/uploads/images";

    let max_body_size: usize = 20 * 1024 * 1024;

    let default_origins = "https://polycentric.io,https://staging-web.polycentric.io,https://web.polycentric.io,https://app.polycentric.io";

    let allowed_origins_str =
        std::env::var("CORS_ALLOWED_ORIGINS").unwrap_or_else(|_| default_origins.to_string());

    let allowed_origins: Vec<String> = allowed_origins_str
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(
            allowed_origins.iter().map(|origin| origin.parse().unwrap()),
        ))
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::ORIGIN,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
            axum::http::header::AUTHORIZATION,
            axum::http::header::HeaderName::from_static("x-polycentric-pubkey-base64"),
            axum::http::header::HeaderName::from_static("x-polycentric-signature-base64"),
            axum::http::header::HeaderName::from_static("x-polycentric-challenge-id"),
        ]);

    Router::new()
        .route("/", get(root))
        // Auth routes
        .route("/auth/challenge", get(get_challenge_handler))
        .route("/auth/check-admin", get(check_admin_handler))
        // Category routes
        .route(
            "/categories",
            post(create_category_handler).get(list_categories_handler),
        )
        .route(
            "/categories/:id",
            get(get_category_handler)
                .put(update_category_handler)
                .delete(delete_category_handler),
        )
        .route("/categories/reorder", put(reorder_categories_handler))
        // Board routes
        .route(
            "/categories/:category_id/boards",
            post(create_board_handler).get(list_boards_in_category_handler),
        )
        .route(
            "/boards/:board_id",
            get(get_board_handler)
                .put(update_board_handler)
                .delete(delete_board_handler),
        )
        .route("/boards/reorder", put(reorder_boards_handler))
        // Thread routes
        .route("/boards/:board_id/threads", post(create_thread_handler))
        .route(
            "/boards/:board_id/threads",
            get(list_threads_in_board_handler),
        )
        .route(
            "/threads/:thread_id",
            axum::routing::on(axum::routing::MethodFilter::GET, get_thread_handler)
                .on(axum::routing::MethodFilter::PUT, update_thread_handler)
                .on(axum::routing::MethodFilter::DELETE, delete_thread_handler),
        )
        // Post routes
        .route("/threads/:thread_id/posts", post(create_post_handler))
        .route(
            "/threads/:thread_id/posts",
            get(list_posts_in_thread_handler),
        )
        .route(
            "/posts/:post_id",
            axum::routing::on(axum::routing::MethodFilter::GET, get_post_handler)
                .on(axum::routing::MethodFilter::PUT, update_post_handler)
                .on(axum::routing::MethodFilter::DELETE, delete_post_handler),
        )
        // --- Add route for linking polycentric post ---
        .route(
            "/posts/:post_id/link-polycentric",
            put(link_polycentric_post_handler),
        )
        // --- End Add route ---
        // User management routes
        .route("/users", get(get_all_users_handler))
        .route("/users/banned", get(get_banned_users_handler))
        .route("/users/ban", post(ban_user_handler))
        .route("/users/unban/:public_key", delete(unban_user_handler))
        .route("/users/check-ban", get(check_ban_status_handler))
        // Server Info Route (at root)
        .route("/server-info", get(get_server_info_handler))
        // --- Static File Serving ---
        // Serve fixed assets (logo) from /app/static under /static/images URL
        .nest_service(static_asset_base_url, static_asset_service)
        // Serve user uploads from IMAGE_UPLOAD_DIR under /uploads/images URL
        .nest_service(user_upload_base_url, user_upload_service)
        .with_state(app_state)
        .layer(RequestBodyLimitLayer::new(max_body_size))
        .layer(cors)
}

async fn root(State(_state): State<AppState>) -> &'static str {
    "Hello, Forum! Database connected."
}

pub mod config;
