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
use crate::auth::AuthenticatedUser; // Import the extractor
use futures_util::stream::StreamExt; 
use serde::Deserialize;
use std::path::Path as StdPath; 
use tokio::fs;
use base64; // Import base64 for printing

// Moved TempImageField definition before its use
#[derive(Debug)]
struct TempImageField {
    filename: Option<String>,
    content_type: Option<Mime>,
    data: Vec<u8>,
}

/// Handler to create a new post with optional image uploads (multipart/form-data).
pub async fn create_post_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
    mut multipart: Multipart,
) -> Response { // Change return type
    let author_id = user.0;

    let mut collected_content: Option<String> = None;
    let mut collected_quote_of: Option<Uuid> = None;
    let mut collected_images: Vec<TempImageField> = Vec::new();

    // --- Multipart Processing --- 
    // (Keep the existing loop structure as it handles errors)
    // Correctly loop over the Result<Option<Field>, Error>
    loop { 
        match multipart.next_field().await {
            Ok(Some(field)) => {
                // Process the field if Ok(Some(field))
                let field_name = match field.name() {
                    Some(name) => name.to_string(),
                    None => continue, // Skip fields without names
                };
                
                // Simplified field processing
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
                    _ => { /* Ignore */ }
                }
            }
            Ok(None) => {
                // End of stream
                break;
            }
            Err(e) => {
                // Handle the error from next_field() itself
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
        Some(c) if !c.is_empty() => c,
        _ => return (StatusCode::BAD_REQUEST, "Missing or empty required field: content").into_response(),
    };

    // --> ADD THREAD EXISTENCE CHECK HERE <--
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

    // --- Database Insert --- 
    let repo_post_data = post_repository::CreatePostData {
        author_id,
        content,
        quote_of: collected_quote_of,
        images: if image_urls.is_empty() { None } else { Some(image_urls) },
    };

    match post_repository::create_post(&state.db_pool, thread_id, repo_post_data).await {
        Ok(post) => (StatusCode::CREATED, Json(post)).into_response(),
        Err(e) => {
            eprintln!("Failed to create post in DB: {}", e);
            // TODO: Add specific DB error checks (e.g., foreign key violation for thread_id?)
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
    user: AuthenticatedUser,
) -> Response { // Change return type
    // Fetch post first
    match post_repository::get_post_by_id(&state.db_pool, post_id).await {
        Ok(Some(post_to_delete)) => {
            // Authorization check
            if post_to_delete.author_id != user.0 {
                 return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }
            
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