use axum::{
    extract::State,
    routing::{get, post, put, delete},
    Router,
};
use sqlx::PgPool;

// Declare the modules (now public for the library)
pub mod models;
pub mod handlers;
pub mod repositories;

// Use the specific handlers
use handlers::{
    category_handlers::{create_category_handler, get_category_handler, list_categories_handler, update_category_handler, delete_category_handler},
    board_handlers::{create_board_handler, get_board_handler, list_boards_in_category_handler, update_board_handler, delete_board_handler},
    thread_handlers::{create_thread_handler, get_thread_handler, list_threads_in_board_handler, update_thread_handler, delete_thread_handler},
    post_handlers::{create_post_handler, get_post_handler, list_posts_in_thread_handler, update_post_handler, delete_post_handler},
};

// Define the application state (now public for the library)
#[derive(Clone)]
pub struct AppState {
    pub db_pool: PgPool,
}

// Function to create the main application router
pub fn create_router(db_pool: PgPool) -> Router {
    // Create the application state
    let app_state = AppState {
        db_pool,
    };

    // Build our application router
    Router::new()
        .route("/", get(root))
        .route("/categories", post(create_category_handler).get(list_categories_handler))
        .route("/categories/:id", get(get_category_handler).put(update_category_handler).delete(delete_category_handler))
        .route("/categories/:category_id/boards", post(create_board_handler).get(list_boards_in_category_handler))
        .route("/boards/:board_id", get(get_board_handler).put(update_board_handler).delete(delete_board_handler))
        .route("/boards/:board_id/threads", post(create_thread_handler).get(list_threads_in_board_handler))
        .route("/threads/:thread_id", get(get_thread_handler).put(update_thread_handler).delete(delete_thread_handler))
        .route("/threads/:thread_id/posts", post(create_post_handler).get(list_posts_in_thread_handler))
        .route("/posts/:post_id", get(get_post_handler).put(update_post_handler).delete(delete_post_handler))
        .with_state(app_state)
}

// Basic handler (can stay here or move to its own handlers module)
async fn root(State(_state): State<AppState>) -> &'static str {
    // We can access the db_pool via state.db_pool if needed
    "Hello, Forum! Database connected."
} 