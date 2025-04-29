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
use crate::auth::{ChallengeStore, get_challenge_handler};
use std::sync::Arc;
use std::sync::RwLock;
use std::collections::HashSet;

// Declare the modules (now public for the library)
pub mod models;
pub mod handlers;
pub mod repositories;
pub mod utils;
pub mod storage;
pub mod auth;

// Use the specific handlers
use handlers::{
    category_handlers::{create_category_handler, get_category_handler, list_categories_handler, update_category_handler, delete_category_handler},
    board_handlers::{create_board_handler, get_board_handler, list_boards_in_category_handler, update_board_handler, delete_board_handler},
    thread_handlers::{create_thread_handler, get_thread_handler, list_threads_in_board_handler, update_thread_handler, delete_thread_handler},
    post_handlers::{create_post_handler, get_post_handler, list_posts_in_thread_handler, update_post_handler, delete_post_handler},
};

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
    let image_storage = LocalImageStorage::new(image_upload_dir.clone(), image_base_url);

    // Create challenge store instance
    let challenge_store = ChallengeStore::new();

    // Create the application state
    let app_state = AppState {
        db_pool,
        image_storage,
        challenge_store,
        admin_pubkeys,
    };

    // Define static file service
    let static_dir = PathBuf::from(&image_upload_dir);
    let static_service = ServeDir::new(static_dir);

    // Define limits (e.g., 20MB)
    const MAX_BODY_SIZE: usize = 20 * 1024 * 1024;

    // Build our application router
    Router::new()
        .route("/", get(root))
        // Auth routes
        .route("/auth/challenge", get(get_challenge_handler))
        // Category routes
        .route("/categories", post(create_category_handler).get(list_categories_handler))
        .route("/categories/:id", get(get_category_handler).put(update_category_handler).delete(delete_category_handler))
        // Board routes
        .route("/categories/:category_id/boards", post(create_board_handler).get(list_boards_in_category_handler))
        .route("/boards/:board_id", get(get_board_handler).put(update_board_handler).delete(delete_board_handler))
        // Thread routes
        .route("/boards/:board_id/threads", post(create_thread_handler))
        .route("/boards/:board_id/threads", get(list_threads_in_board_handler))
        .route("/threads/:thread_id", get(get_thread_handler).put(update_thread_handler).delete(delete_thread_handler))
        // Post routes
        .route("/threads/:thread_id/posts", post(create_post_handler))
        .route("/threads/:thread_id/posts", get(list_posts_in_thread_handler))
        .route("/posts/:post_id", get(get_post_handler).put(update_post_handler).delete(delete_post_handler))
        // Static file serving
        .nest_service(&app_state.image_storage.base_url, static_service)
        .with_state(app_state)
        // Layers
        .layer(RequestBodyLimitLayer::new(MAX_BODY_SIZE))
}

// Basic handler (can stay here or move to its own handlers module)
async fn root(State(_state): State<AppState>) -> &'static str {
    // We can access the db_pool via state.db_pool if needed
    "Hello, Forum! Database connected."
} 