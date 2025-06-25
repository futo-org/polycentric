use axum::{
    extract::State,
    routing::{get, post, put, delete},
    Router,
    routing::get_service,
};
use sqlx::PgPool;
use tower_http::services::ServeDir;
use std::path::PathBuf;
use tower_http::limit::RequestBodyLimitLayer;
use crate::auth::{ChallengeStore, get_challenge_handler, check_admin_handler};
use std::sync::Arc;
use std::sync::RwLock;
use std::collections::HashSet;
// Import necessary CORS items
// REMOVED: use tower_http::cors::{Any, CorsLayer};
// REMOVED: use axum::http::{Method, HeaderValue};

// Declare the modules (now public for the library)
pub mod models;
pub mod handlers;
pub mod repositories;
pub mod utils;
pub mod storage;
pub mod auth;
pub mod constants;

// Use the specific handlers
use handlers::{
    category_handlers::{create_category_handler, get_category_handler, list_categories_handler, update_category_handler, delete_category_handler, reorder_categories_handler},
    board_handlers::{create_board_handler, get_board_handler, list_boards_in_category_handler, update_board_handler, delete_board_handler, reorder_boards_handler},
    thread_handlers::{create_thread_handler, get_thread_handler, list_threads_in_board_handler, update_thread_handler, delete_thread_handler},
    post_handlers::{create_post_handler, get_post_handler, list_posts_in_thread_handler, update_post_handler, delete_post_handler, link_polycentric_post_handler},
    get_server_info_handler,
};

// TODO break into read and write pools if we want HA routes.

// Use storage
use storage::LocalImageStorage;

// Define the application state (now public for the library)
#[derive(Clone, axum::extract::FromRef)]
pub struct AppState {
    pub db_pool: PgPool,
    pub image_storage: LocalImageStorage,
    pub challenge_store: ChallengeStore,
    pub admin_pubkeys: Arc<HashSet<Vec<u8>>>,
}

// Function to create the main application router
pub fn create_router(
    db_pool: PgPool, 
    image_upload_dir: String, 
    image_base_url: String, 
    admin_pubkeys: Arc<HashSet<Vec<u8>>>,
) -> Router {
    // Create image storage instance
    let image_storage = LocalImageStorage::new(image_upload_dir.clone(), image_base_url.clone());

    // Create challenge store instance
    let challenge_store = ChallengeStore::new();

    // Create the application state
    let app_state = AppState {
        db_pool,
        image_storage: image_storage.clone(),
        challenge_store,
        admin_pubkeys,
    };

    // --- Define Static Asset Service (for logo, etc.) ---
    let static_assets_dir = PathBuf::from("/app/static/images"); 
    let static_asset_service = ServeDir::new(static_assets_dir);
    let static_asset_base_url = "/static/images"; // The URL path prefix

    // --- Define User Upload Service --- 
    let user_upload_dir = PathBuf::from(image_upload_dir); // Use the env var for upload *path*
    let user_upload_service = ServeDir::new(user_upload_dir);
    let user_upload_base_url = "/uploads/images"; // Define the new URL prefix for uploads

    // REMOVED: CORS Configuration block
    // let cors = CorsLayer::new()... 

    // Define limits (e.g., 20MB)
    const MAX_BODY_SIZE: usize = 20 * 1024 * 1024;

    // --- Build Main Application Router ---
    Router::new()
        .route("/", get(root))
        // --- Original routes at root ---
        // Auth routes
        .route("/auth/challenge", get(get_challenge_handler))
        .route("/auth/check-admin", get(check_admin_handler))
        // Category routes
        .route("/categories", post(create_category_handler).get(list_categories_handler))
        .route("/categories/:id", get(get_category_handler).put(update_category_handler).delete(delete_category_handler))
        .route("/categories/reorder", put(reorder_categories_handler))
        // Board routes
        .route("/categories/:category_id/boards", post(create_board_handler).get(list_boards_in_category_handler))
        .route("/boards/:board_id", get(get_board_handler).put(update_board_handler).delete(delete_board_handler))
        .route("/boards/reorder", put(reorder_boards_handler))
        // Thread routes
        .route("/boards/:board_id/threads", post(create_thread_handler))
        .route("/boards/:board_id/threads", get(list_threads_in_board_handler))
        .route("/threads/:thread_id", 
            axum::routing::on(axum::routing::MethodFilter::GET, get_thread_handler)
            .on(axum::routing::MethodFilter::PUT, update_thread_handler)
            .on(axum::routing::MethodFilter::DELETE, delete_thread_handler)
        )
        // Post routes
        .route("/threads/:thread_id/posts", post(create_post_handler))
        .route("/threads/:thread_id/posts", get(list_posts_in_thread_handler))
        .route("/posts/:post_id", get(get_post_handler).put(update_post_handler).delete(delete_post_handler))
        // --- Add route for linking polycentric post --- 
        .route("/posts/:post_id/link-polycentric", put(link_polycentric_post_handler)) 
        // --- End Add route ---
        // Server Info Route (at root)
        .route("/server-info", get(get_server_info_handler))

        // --- Static File Serving ---
        // Serve fixed assets (logo) from /app/static under /static/images URL
        .nest_service(static_asset_base_url, static_asset_service)
        // Serve user uploads from IMAGE_UPLOAD_DIR under /uploads/images URL
        .nest_service(user_upload_base_url, user_upload_service)
        .with_state(app_state)
        // REMOVED: .layer(cors)
        .layer(RequestBodyLimitLayer::new(MAX_BODY_SIZE))
}

// Basic handler (can stay here or move to its own handlers module)
async fn root(State(_state): State<AppState>) -> &'static str {
    // We can access the db_pool via state.db_pool if needed
    "Hello, Forum! Database connected."
} 