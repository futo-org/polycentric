use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use mime::Mime;
use uuid::Uuid;
use crate::{
    models::Post,
    repositories::{self, thread_repository, post_repository::{self, CreatePostData, UpdatePostData}},
    utils::PaginationParams, // Import
    AppState,
    constants::MAX_POST_CONTENT_LENGTH,
};
use axum::extract::multipart::MultipartError;
use multer::Error as MulterError;
use std::error::Error;
use crate::auth::{AuthenticatedUser, AdminUser}; // Import AdminUser
use futures_util::stream::StreamExt; 
use serde::Deserialize;
use std::path::Path as StdPath; 
use tokio::fs;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _}; // Import base64 for decoding
use sqlx::Acquire; // Import Acquire trait for starting transactions
use tracing::{error, info, warn, debug};

// Moved TempImageField definition before its use
#[derive(Debug)]
struct TempImageField {
    filename: Option<String>,
    content_type: Option<Mime>,
    data: Vec<u8>,
}

/// Handler to create a new post with optional image uploads and Polycentric pointer.
pub async fn create_post_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
    mut multipart: Multipart,
) -> Response { 
    let author_id = user.0;

    let mut collected_content: Option<String> = None;
    let mut collected_quote_of: Option<Uuid> = None;
    let mut collected_images: Vec<TempImageField> = Vec::new();
    let mut collected_poly_system_id_b64: Option<String> = None;
    let mut collected_poly_process_id_b64: Option<String> = None;
    let mut collected_poly_log_seq_str: Option<String> = None;

    loop { 
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let field_name = match field.name() {
                    Some(name) => name.to_string(),
                    None => continue, 
                };
                
                match field_name.as_str() {
                    "content" => {
                        match field.bytes().await {
                            Ok(data) => {
                                 match String::from_utf8(data.to_vec()) {
                                    Ok(s) => collected_content = Some(s),
                                    Err(_) => return (StatusCode::BAD_REQUEST, "Invalid UTF-8 in content field").into_response(),
                                 }
                            }
                            Err(e) => return (StatusCode::BAD_REQUEST, format!("Failed to read content field: {}", e)).into_response(),
                        }
                    }
                    "quote_of" => {
                        match field.bytes().await {
                            Ok(data) => {
                                match String::from_utf8(data.to_vec()) {
                                    Ok(value_str) => {
                                        if !value_str.is_empty() {
                                            match Uuid::parse_str(&value_str) {
                                                Ok(uuid) => collected_quote_of = Some(uuid),
                                                Err(_) => return (StatusCode::BAD_REQUEST, "Invalid UUID format for quote_of").into_response(),
                                            }
                                        }
                                    }
                                    Err(_) => return (StatusCode::BAD_REQUEST, "Invalid UTF-8 in quote_of field").into_response(),
                                }
                            }
                            Err(e) => return (StatusCode::BAD_REQUEST, format!("Failed to read quote_of field: {}", e)).into_response(),
                        }
                    }
                    "image" => {
                        if collected_images.len() >= MAX_IMAGES_PER_POST {
                            return (StatusCode::BAD_REQUEST, format!("Exceeded maximum number of images ({})", MAX_IMAGES_PER_POST)).into_response();
                        }
                        let filename = field.file_name().map(|s| s.to_string());
                        let content_type = field.content_type().and_then(|s| s.parse::<Mime>().ok());
                        match field.bytes().await {
                            Ok(data) => {
                                if data.len() as u64 > MAX_IMAGE_SIZE_BYTES {
                                    return (StatusCode::PAYLOAD_TOO_LARGE, format!("Image size exceeds limit ({} MB)", MAX_IMAGE_SIZE_MB)).into_response();
                                }
                                collected_images.push(TempImageField {
                                    filename,
                                    content_type,
                                    data: data.to_vec(),
                                });
                            }
                            Err(e) => return (StatusCode::BAD_REQUEST, format!("Failed to read image data: {}", e)).into_response(),
                        }
                    }
                    "polycentric_system_id" => {
                        match field.text().await {
                            Ok(text) => collected_poly_system_id_b64 = Some(text),
                            Err(e) => return (StatusCode::BAD_REQUEST, format!("Failed to read polycentric_system_id: {}", e)).into_response(),
                        }
                    }
                    "polycentric_process_id" => {
                        match field.text().await {
                            Ok(text) => collected_poly_process_id_b64 = Some(text),
                            Err(e) => return (StatusCode::BAD_REQUEST, format!("Failed to read polycentric_process_id: {}", e)).into_response(),
                        }
                    }
                    "polycentric_log_seq" => {
                        match field.text().await {
                            Ok(text) => collected_poly_log_seq_str = Some(text),
                            Err(e) => return (StatusCode::BAD_REQUEST, format!("Failed to read polycentric_log_seq: {}", e)).into_response(),
                        }
                    }
                    _ => { /* Ignore */ }
                }
            }
            Ok(None) => break, 
            Err(e) => {
                warn!(error = %e, "Multipart processing error");
                if e.to_string().contains("body limit exceeded") {
                    return (StatusCode::PAYLOAD_TOO_LARGE, "Total upload size limit exceeded").into_response();
                }
                return (StatusCode::BAD_REQUEST, format!("Multipart processing error: {}", e)).into_response();
            }
        }
    }

    // --- Validation --- 
    let content = match collected_content {
        Some(c) if !c.trim().is_empty() => c.trim().to_string(), // Trim content
        _ => return (StatusCode::BAD_REQUEST, "Missing or empty required field: content").into_response(),
    };

    // Enforce character limit for post content
    if content.chars().count() > MAX_POST_CONTENT_LENGTH {
        return (StatusCode::BAD_REQUEST, format!(
            "Content exceeds maximum length of {} characters",
            MAX_POST_CONTENT_LENGTH
        )).into_response();
    }

    // --- Added: Decode pointer fields --- 
    let polycentric_system_id = match collected_poly_system_id_b64 {
        Some(b64) => match BASE64_STANDARD.decode(b64) {
            Ok(bytes) => Some(bytes),
            Err(_) => return (StatusCode::BAD_REQUEST, "Invalid base64 for polycentric_system_id").into_response(),
        },
        None => None,
    };
    let polycentric_process_id = match collected_poly_process_id_b64 {
        Some(b64) => match BASE64_STANDARD.decode(b64) {
            Ok(bytes) => Some(bytes),
            Err(_) => return (StatusCode::BAD_REQUEST, "Invalid base64 for polycentric_process_id").into_response(),
        },
        None => None,
    };
    let polycentric_log_seq = match collected_poly_log_seq_str {
        Some(s) => match s.parse::<i64>() {
            Ok(num) => Some(num),
            Err(_) => return (StatusCode::BAD_REQUEST, "Invalid number format for polycentric_log_seq").into_response(),
        },
        None => None,
    };
    // Optional: Add validation if pointer fields must appear together
    if polycentric_system_id.is_some() != polycentric_process_id.is_some() || polycentric_system_id.is_some() != polycentric_log_seq.is_some() {
        return (StatusCode::BAD_REQUEST, "Polycentric pointer fields must be provided together or not at all").into_response();
    }

    // Check thread existence
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(_)) => { /* Thread exists, continue */ }
        Ok(None) => return (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            error!(error = %e, thread_id = %thread_id, "DB error checking thread existence during post creation");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Error checking thread existence").into_response();
        }
    }

    // Check quote_of existence if provided
    if let Some(quote_id) = collected_quote_of {
        match post_repository::get_post_by_id(&state.db_pool, quote_id).await {
            Ok(Some(_)) => { /* Quoted post exists */ }
            Ok(None) => return (StatusCode::BAD_REQUEST, "Quoted post not found").into_response(),
            Err(e) => {
                error!(error = %e, quote_id = %quote_id, "DB error checking quoted post during post creation");
                return (StatusCode::INTERNAL_SERVER_ERROR, "Error checking quoted post").into_response();
            }
        }
    }

    // --- Image Saving --- 
    let mut image_urls: Vec<String> = Vec::new();
    for image_field in collected_images {
        // Clone filename for logging
        let filename_for_log = image_field.filename.clone();
        match state.image_storage.save_image(
            image_field.data.into(), 
            image_field.filename, // Pass original owned Option<String>
        ).await {
            Ok(url) => image_urls.push(url),
            Err(e) => {
                // Use the cloned filename in the log
                error!(error = %e, filename = ?filename_for_log, "Failed to save image during post creation");
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save image").into_response();
            }
        }
    }

    // --- Database Insert within a Transaction --- 
    let mut tx = match state.db_pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            error!(error = %e, "Failed to begin transaction for post creation");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }
    };

    // --- Updated: Pass pointer fields to CreatePostData --- 
    let repo_post_data = post_repository::CreatePostData {
        author_id,
        content,
        quote_of: collected_quote_of,
        images: if image_urls.is_empty() { None } else { Some(image_urls) },
        polycentric_system_id,
        polycentric_process_id,
        polycentric_log_seq,
    };

    match post_repository::create_post(&mut tx, thread_id, repo_post_data).await {
        Ok(post) => {
            // Commit the transaction before returning success
            if let Err(e) = tx.commit().await {
                error!(error = %e, thread_id = %thread_id, post_id = %post.id, "Failed to commit transaction after creating post");
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save post").into_response();
            }
            info!(post_id = %post.id, thread_id = %thread_id, author_id = ?post.author_id, "Successfully created post");
            (StatusCode::CREATED, Json(post)).into_response()
        }
        Err(e) => {
            // Log the error. Rollback is implicit on drop.
            error!(error = %e, thread_id = %thread_id, "Failed to create post in DB (transaction rolling back)");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create post").into_response()
        }
    }
}

/// Handler to get a single post by its ID.
pub async fn get_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
) -> Response { // Change return type
    match post_repository::get_post_by_id(&state.db_pool, post_id).await {
        Ok(Some(post)) => (StatusCode::OK, Json(post)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "Post not found").into_response(),
        Err(e) => {
            error!(error = %e, post_id = %post_id, "Failed to fetch post");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch post").into_response()
        }
    }
}

/// Handler to list all posts within a specific thread with pagination.
pub async fn list_posts_in_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    Query(pagination): Query<PaginationParams>,
) -> Response { // Change return type
    // Check if thread exists first
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(_)) => {
             // Thread exists, list posts
            match post_repository::get_posts_by_thread(&state.db_pool, thread_id, &pagination).await {
                Ok(posts) => (StatusCode::OK, Json(posts)).into_response(),
                Err(e) => {
                    error!(error = %e, thread_id = %thread_id, "Failed to fetch posts for thread");
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch posts").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            error!(error = %e, thread_id = %thread_id, "Error checking thread existence before listing posts");
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking thread").into_response()
        }
    }
}

/// Handler to update a post's content.
pub async fn update_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<UpdatePostPayload>,
) -> Response { // Change return type
     // Fetch post first
     match post_repository::get_post_by_id(&state.db_pool, post_id).await {
        Ok(Some(post_to_update)) => {
             // Authorization check
            if post_to_update.author_id != user.0 {
                warn!(post_id = %post_id, user_pubkey = ?user.0, actual_author = ?post_to_update.author_id, "User attempted to update post they did not create");
                return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }

            // Validate new content
            let trimmed_content = payload.content.trim();
            if trimmed_content.is_empty() {
                return (StatusCode::BAD_REQUEST, "Content cannot be empty").into_response();
            }
            if trimmed_content.chars().count() > MAX_POST_CONTENT_LENGTH {
                return (StatusCode::BAD_REQUEST, format!(
                    "Content exceeds maximum length of {} characters",
                    MAX_POST_CONTENT_LENGTH
                )).into_response();
            }

            // Construct update data
            let update_data = UpdatePostData { content: trimmed_content.to_string() };

             // Perform update
            match post_repository::update_post(&state.db_pool, post_id, update_data).await {
                Ok(Some(updated_post)) => {
                    info!(post_id = %updated_post.id, "Successfully updated post");
                    (StatusCode::OK, Json(updated_post)).into_response()
                }
                Ok(None) => {
                    // Should be rare if author check passed, but handle defensively
                    warn!(post_id = %post_id, user_pubkey = ?user.0, "Post not found during update attempt, despite passing author check");
                    (StatusCode::NOT_FOUND, "Post not found during update").into_response()
                }
                Err(e) => {
                    error!(error = %e, post_id = %post_id, "Failed to update post in database");
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update post").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Post not found").into_response(),
        Err(e) => {
            error!(error = %e, post_id = %post_id, "Failed to fetch post for update");
            (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching post for update").into_response()
        }
    }
}

/// Handler to delete a post.
pub async fn delete_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
    user: AuthenticatedUser, // Authenticated user's pubkey is user.0
) -> Response { 
    let user_pubkey = user.0; // Extract user's public key

    // Check authorization: Fetch author ID first
    match post_repository::get_post_author(&state.db_pool, post_id).await {
        Ok(Some(author_id)) => {
            if author_id != user_pubkey {
                // Log the attempt and return Forbidden
                warn!(post_id = %post_id, user_pubkey = ?user_pubkey, actual_author = ?author_id, "User attempted to delete post they did not create");
                return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }
            // User is authorized, proceed to delete
        }
        Ok(None) => {
            warn!(post_id = %post_id, user_pubkey = ?user_pubkey, "User attempted to delete non-existent post");
            return (StatusCode::NOT_FOUND, "Post not found").into_response();
        }
        Err(e) => {
            error!(error = %e, post_id = %post_id, "Failed to check post author before deletion");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error checking author").into_response();
        }
    }

    // Proceed with deletion
    match post_repository::delete_post(&state.db_pool, post_id).await {
        Ok(rows_affected) if rows_affected == 1 => {
            info!(post_id = %post_id, deleted_by_user = ?user_pubkey, "Successfully deleted post");
            (StatusCode::NO_CONTENT).into_response()
        }
        Ok(_) => {
            // rows_affected was 0, post likely already deleted
             warn!(post_id = %post_id, deleted_by_user = ?user_pubkey, "Attempted delete, but post not found during delete operation (0 rows affected)");
            (StatusCode::NOT_FOUND, "Post not found").into_response()
        }
        Err(e) => {
            error!(error = %e, post_id = %post_id, deleted_by_user = ?user_pubkey, "Failed to delete post from database");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete post").into_response()
        }
    }
}

// --- Constants ---
const MAX_IMAGES_PER_POST: usize = 5;
const MAX_IMAGE_SIZE_MB: u64 = 10;
const MAX_IMAGE_SIZE_BYTES: u64 = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// This struct definition is fine here
#[derive(Deserialize)]
pub struct UpdatePostPayload {
    content: String,
}

// --- New Payload for Linking Polycentric Post --- 
#[derive(Deserialize)]
pub struct LinkPolycentricPayload {
    polycentric_system_id_b64: String,
    polycentric_process_id_b64: String,
    polycentric_log_seq: i64, // Frontend will send as number/string, backend expects i64
}

// --- New Handler to Link Polycentric Post --- 
pub async fn link_polycentric_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<LinkPolycentricPayload>,
) -> Response {
    let user_pubkey = user.0;

    // 1. Verify user is the author of the post
    match post_repository::get_post_author(&state.db_pool, post_id).await {
        Ok(Some(author_id)) => {
            if author_id != user_pubkey {
                warn!(post_id = %post_id, user_pubkey = ?user_pubkey, actual_author = ?author_id, "User attempted to link Polycentric pointer to post they don't own");
                return (StatusCode::FORBIDDEN, "Permission denied. You can only link your own posts.").into_response();
            }
        }
        Ok(None) => {
            warn!(post_id = %post_id, user_pubkey = ?user_pubkey, "Attempted to link non-existent post");
            return (StatusCode::NOT_FOUND, "Post not found.").into_response();
        }
        Err(e) => {
            error!(error = %e, post_id = %post_id, "Failed to check post author before linking Polycentric pointer");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error checking author.").into_response();
        }
    }

    // 2. Decode Base64 IDs
    let system_id = match BASE64_STANDARD.decode(&payload.polycentric_system_id_b64) {
        Ok(id) => id,
        Err(_) => {
            warn!(post_id = %post_id, user_pubkey = ?user_pubkey, "Invalid base64 for system_id provided by user");
            return (StatusCode::BAD_REQUEST, "Invalid base64 format for polycentric_system_id").into_response();
        }
    };
    let process_id = match BASE64_STANDARD.decode(&payload.polycentric_process_id_b64) {
        Ok(id) => id,
        Err(_) => {
            warn!(post_id = %post_id, user_pubkey = ?user_pubkey, "Invalid base64 for process_id provided by user");
            return (StatusCode::BAD_REQUEST, "Invalid base64 format for polycentric_process_id").into_response();
        }
    };

    // 3. Call repository to update the post with pointer details
    match post_repository::update_polycentric_pointers(
        &state.db_pool, 
        post_id, 
        system_id, 
        process_id, 
        payload.polycentric_log_seq
    ).await {
        Ok(rows_affected) if rows_affected == 1 => {
            info!(post_id = %post_id, user_pubkey = ?user_pubkey, log_seq = payload.polycentric_log_seq, "Successfully linked Polycentric pointer to post");
            StatusCode::OK.into_response()
        }
        Ok(_) => {
            // Should be rare if author check passed, but handle defensively
            warn!(post_id = %post_id, user_pubkey = ?user_pubkey, "Post not found during link attempt, despite passing author check");
            StatusCode::NOT_FOUND.into_response()
        }
        Err(e) => {
            error!(error = %e, post_id = %post_id, user_pubkey = ?user_pubkey, "Failed to link Polycentric pointer in database");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
} 