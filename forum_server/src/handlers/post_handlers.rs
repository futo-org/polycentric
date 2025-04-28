use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;
use crate::{
    models::Post,
    repositories::{post_repository::{self, CreatePostData, UpdatePostData}, thread_repository}, // Import post and thread repos
    AppState,
};

/// Handler to create a new post within a thread.
pub async fn create_post_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>, // Extract thread_id from path
    Json(payload): Json<CreatePostData>,
) -> Response {
    // Optional: Check if thread exists first
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(_)) => {
            // Optional: Check if quote_of post exists if provided
            if let Some(quote_id) = payload.quote_of {
                match post_repository::get_post_by_id(&state.db_pool, quote_id).await {
                    Ok(Some(_)) => { /* Quoted post exists, proceed */ }
                    Ok(None) => return (StatusCode::BAD_REQUEST, "Quoted post not found").into_response(),
                    Err(e) => {
                        eprintln!("Failed to check quoted post existence: {}", e);
                        return (StatusCode::INTERNAL_SERVER_ERROR, "Error checking quoted post").into_response();
                    }
                }
            }

            // Thread exists (and quoted post, if any), proceed to create post
            match post_repository::create_post(&state.db_pool, thread_id, payload).await {
                Ok(new_post) => {
                    (StatusCode::CREATED, Json(new_post)).into_response()
                }
                Err(e) => {
                    eprintln!("Failed to create post: {}", e);
                    // Could be FK constraint error if quote_of is somehow invalid despite check
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create post").into_response()
                }
            }
        }
        Ok(None) => {
            // Thread not found
            (StatusCode::NOT_FOUND, "Thread not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to check thread existence: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking thread").into_response()
        }
    }
}

/// Handler to get a single post by its ID.
pub async fn get_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
) -> Response {
    match post_repository::get_post_by_id(&state.db_pool, post_id).await {
        Ok(Some(post)) => {
            (StatusCode::OK, Json(post)).into_response()
        }
        Ok(None) => {
            (StatusCode::NOT_FOUND, "Post not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to fetch post: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch post").into_response()
        }
    }
}

/// Handler to list all posts within a specific thread.
pub async fn list_posts_in_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
) -> Response {
    // Optional: Check if thread exists first
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(_)) => {
            // Thread exists, proceed to list posts
            match post_repository::get_posts_by_thread(&state.db_pool, thread_id).await {
                Ok(posts) => {
                    (StatusCode::OK, Json(posts)).into_response()
                }
                Err(e) => {
                    eprintln!("Failed to fetch posts for thread {}: {}", thread_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch posts").into_response()
                }
            }
        }
        Ok(None) => {
            // Thread not found
            (StatusCode::NOT_FOUND, "Thread not found").into_response()
        }
        Err(e) => {
            eprintln!("Failed to check thread existence: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking thread").into_response()
        }
    }
}

/// Handler to update a post's content.
/// TODO: Add authorization check - only post author should update.
pub async fn update_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
    // user: AuthenticatedUser, // Would get user from auth middleware
    Json(payload): Json<UpdatePostData>,
) -> Response {
    // let requesting_user_id = user.id; // Placeholder for authenticated user ID
    match post_repository::update_post(&state.db_pool, post_id, /* &requesting_user_id, */ payload).await {
        Ok(Some(updated_post)) => {
            // Post found and updated (ownership check passed if implemented)
            (StatusCode::OK, Json(updated_post)).into_response()
        }
        Ok(None) => {
            // Post not found, or user doesn't own it (if check implemented)
            (StatusCode::NOT_FOUND, "Post not found or permission denied").into_response()
        }
        Err(e) => {
            eprintln!("Failed to update post: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update post").into_response()
        }
    }
}

/// Handler to delete a post.
/// TODO: Add authorization check - only post author should delete.
pub async fn delete_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
    // user: AuthenticatedUser, // Would get user from auth middleware
) -> Response {
    // let requesting_user_id = user.id; // Placeholder
    match post_repository::delete_post(&state.db_pool, post_id /*, &requesting_user_id*/).await {
        Ok(rows_affected) if rows_affected == 1 => {
            // Post found and deleted (ownership check passed if implemented)
            (StatusCode::NO_CONTENT).into_response()
        }
        Ok(_) => {
            // Post not found, or user doesn't own it (if check implemented)
            (StatusCode::NOT_FOUND, "Post not found or permission denied").into_response()
        }
        Err(e) => {
            eprintln!("Failed to delete post: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete post").into_response()
        }
    }
} 