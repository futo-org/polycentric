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
                eprintln!("Multipart error processing field: {}", e);
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
            eprintln!("DB error checking thread existence: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Error checking thread existence").into_response();
        }
    }

    // Check quote_of existence if provided
    if let Some(quote_id) = collected_quote_of {
        match post_repository::get_post_by_id(&state.db_pool, quote_id).await {
            Ok(Some(_)) => { /* Quoted post exists */ }
            Ok(None) => return (StatusCode::BAD_REQUEST, "Quoted post not found").into_response(),
            Err(e) => {
                eprintln!("DB error checking quoted post: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Error checking quoted post").into_response();
            }
        }
    }

    // --- Image Saving --- 
    let mut image_urls: Vec<String> = Vec::new();
    for image_field in collected_images {
        match state.image_storage.save_image(
            image_field.data.into(), 
            image_field.filename,
        ).await {
            Ok(url) => image_urls.push(url),
            Err(e) => {
                eprintln!("Failed to save image: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save image").into_response();
            }
        }
    }

    // --- Database Insert within a Transaction --- 
    let mut tx = match state.db_pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            eprintln!("Failed to begin transaction: {}", e);
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
                eprintln!("Failed to commit transaction: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save post").into_response();
            }
            (StatusCode::CREATED, Json(post)).into_response()
        }
        Err(e) => {
            eprintln!("Failed to create post in DB (transaction rolled back): {}", e);
            // Transaction is automatically rolled back on drop if not committed
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
            eprintln!("Failed to fetch post: {}", e);
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
                    eprintln!("Failed to fetch posts for thread {}: {}", thread_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch posts").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            eprintln!("Failed to check thread existence: {}", e);
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
                return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }

            // Construct update data
            let update_data = UpdatePostData { content: payload.content };

             // Perform update
            match post_repository::update_post(&state.db_pool, post_id, update_data).await {
                Ok(Some(updated_post)) => (StatusCode::OK, Json(updated_post)).into_response(),
                Ok(None) => (StatusCode::NOT_FOUND, "Post not found during update").into_response(), // Should be rare
                Err(e) => {
                    eprintln!("Failed to update post: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update post").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Post not found").into_response(),
        Err(e) => {
            eprintln!("Failed to fetch post for update: {}", e);
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
    match post_repository::get_post_by_id(&state.db_pool, post_id).await {
        Ok(Some(post_to_delete)) => {
            // Authorization Check
            let requester_pubkey = &user.0;
            let post_author_id = &post_to_delete.author_id;

            // --- DEBUG LOGGING --- 
            eprintln!("DELETE CHECK FOR POST {}", post_id);
            eprintln!("  Requester PubKey (Base64): {}", base64::encode(requester_pubkey));
            eprintln!("  Post Author ID (Base64)  : {}", base64::encode(post_author_id));
            // --- END DEBUG LOGGING ---

            let is_author = post_author_id == requester_pubkey;
            let is_admin = state.admin_pubkeys.contains(requester_pubkey);

            eprintln!("  Is Author Check Result: {}", is_author); // Log check result
            eprintln!("  Is Admin Check Result : {}", is_admin);  // Log check result

            if !is_author && !is_admin {
                 eprintln!("  Authorization FAILED: Neither author nor admin."); // Log failure
                 return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }
            
             eprintln!("  Authorization SUCCEEDED."); // Log success
             // Perform delete
             match post_repository::delete_post(&state.db_pool, post_id).await {
                 Ok(0) => (StatusCode::NOT_FOUND, "Post not found during delete").into_response(), // Should be rare
                 Ok(_) => (StatusCode::NO_CONTENT).into_response(), // Success (1 row deleted)
                 Err(e) => {
                    eprintln!("Failed to delete post: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete post").into_response()
                 }
             }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Post not found").into_response(),
        Err(e) => {
            eprintln!("Failed to fetch post for delete: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching post for delete").into_response()
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
    match post_repository::get_post_by_id(&state.db_pool, post_id).await {
        Ok(Some(post_to_link)) => {
            if post_to_link.author_id != user.0 {
                return (StatusCode::FORBIDDEN, "Permission denied: Only the author can link the post.").into_response();
            }

            let system_id = match base64::decode(&payload.polycentric_system_id_b64) {
                Ok(id) => id,
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, "Invalid base64 for polycentric_system_id").into_response();
                }
            };
            let process_id = match base64::decode(&payload.polycentric_process_id_b64) {
                Ok(id) => id,
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, "Invalid base64 for polycentric_process_id").into_response();
                }
            };
            let log_seq = payload.polycentric_log_seq;

            match post_repository::update_polycentric_pointers(
                &state.db_pool, 
                post_id, 
                system_id, 
                process_id, 
                log_seq
            ).await {
                Ok(updated_rows) => {
                    if updated_rows == 1 {
                        match post_repository::get_post_by_id(&state.db_pool, post_id).await {
                            Ok(Some(updated_post)) => (StatusCode::OK, Json(updated_post)).into_response(),
                            Ok(None) => (StatusCode::NOT_FOUND, "Post not found after update").into_response(), // Should not happen
                            Err(e) => {
                                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch updated post").into_response()
                            }
                        }
                    } else {
                        (StatusCode::NOT_FOUND, "Post not found during link update").into_response()
                    }
                }
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update post with polycentric link").into_response()
                }
            }
        }
        Ok(None) => {
            (StatusCode::NOT_FOUND, "Post not found").into_response()
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching post for linking").into_response()
        }
    }
} 