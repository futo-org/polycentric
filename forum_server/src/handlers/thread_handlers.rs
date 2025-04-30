use axum::{
    extract::{Path, Query, State, Multipart},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;
use crate::{
    models::Thread,
    repositories::{self, board_repository, thread_repository::{self, CreateThreadData, UpdateThreadData}},
    utils::PaginationParams, // Import
    AppState,
    auth::AuthenticatedUser, // Import the extractor
};
use serde::Deserialize;
use mime;
use futures_util::stream::StreamExt;
use base64; // Keep if needed elsewhere, or remove

// Define constants if they aren't globally available (copy from post_handlers.rs)
const MAX_IMAGES_PER_POST: usize = 5;
const MAX_IMAGE_SIZE_MB: u64 = 10;
const MAX_IMAGE_SIZE_BYTES: u64 = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// Temporary struct for holding image data during processing
#[derive(Debug)]
struct TempImageField {
    filename: Option<String>,
    content_type: Option<mime::Mime>,
    data: Vec<u8>,
}

/// Handler to create a new thread with initial post and optional images (multipart/form-data).
pub async fn create_thread_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    user: AuthenticatedUser,
    mut multipart: Multipart, // Expect multipart data now
) -> Response {
    let created_by = user.0;

    // --- Multipart Processing --- 
    let mut collected_title: Option<String> = None;
    let mut collected_content: Option<String> = None;
    let mut collected_images: Vec<TempImageField> = Vec::new();

    loop { 
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let field_name = match field.name() {
                    Some(name) => name.to_string(),
                    None => continue, 
                };
                
                match field_name.as_str() {
                    "title" => {
                        match field.bytes().await {
                            Ok(data) => {
                                 match String::from_utf8(data.to_vec()) {
                                    Ok(s) => collected_title = Some(s),
                                    Err(_) => return (StatusCode::BAD_REQUEST, "Invalid UTF-8 in title field").into_response(),
                                 }
                            }
                            Err(e) => return (StatusCode::BAD_REQUEST, format!("Failed to read title field: {}", e)).into_response(),
                        }
                    }
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
                    "image" => {
                         if collected_images.len() >= MAX_IMAGES_PER_POST {
                             return (StatusCode::BAD_REQUEST, format!("Exceeded maximum number of images ({})", MAX_IMAGES_PER_POST)).into_response();
                         }
                         let filename = field.file_name().map(|s| s.to_string());
                         let content_type = field.content_type().and_then(|s| s.parse::<mime::Mime>().ok());
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
                    _ => { /* Ignore other fields like quote_of */ }
                }
            }
            Ok(None) => break, // End of stream
            Err(e) => { // Handle stream error
                eprintln!("Multipart error processing field: {}", e);
                if e.to_string().contains("body limit exceeded") {
                    return (StatusCode::PAYLOAD_TOO_LARGE, "Total upload size limit exceeded").into_response();
                }
                return (StatusCode::BAD_REQUEST, format!("Multipart processing error: {}", e)).into_response();
            }
        }
    }

    // --- Validation --- 
    let title = match collected_title {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, "Missing or empty required field: title").into_response(),
    };
    let content = match collected_content {
        Some(c) if !c.trim().is_empty() => c.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, "Missing or empty required field: content").into_response(),
    };

    // Check board existence
    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(_)) => { /* Board exists */ }
        Ok(None) => return (StatusCode::NOT_FOUND, "Board not found").into_response(),
        Err(e) => {
            eprintln!("DB error checking board existence: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Error checking board existence").into_response();
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
                eprintln!("Failed to save image during thread creation: {}", e);
                // Consider deleting already saved images if one fails?
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save image").into_response();
            }
        }
    }
    
    // Prepare data for repository
    let thread_data = repositories::thread_repository::CreateThreadData {
        title,
        content,
        created_by,
        images: if image_urls.is_empty() { None } else { Some(image_urls) },
    };

    // Call repository function
    match thread_repository::create_thread_with_initial_post(&state.db_pool, board_id, thread_data).await {
        Ok(thread) => (StatusCode::CREATED, Json(thread)).into_response(),
        Err(e) => {
            eprintln!("Failed to create thread with initial post: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create thread").into_response()
        }
    }
}

/// Handler to get a single thread by its ID.
pub async fn get_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
) -> Response {
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread)) => (StatusCode::OK, Json(thread)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            eprintln!("Failed to fetch thread: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch thread").into_response()
        }
    }
}

/// Handler to list all threads within a specific board with pagination.
pub async fn list_threads_in_board_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    Query(pagination): Query<PaginationParams>,
) -> Response {
    // Check if board exists first
    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(_)) => {
            // Board exists, list threads
            match thread_repository::get_threads_by_board(&state.db_pool, board_id, &pagination).await {
                Ok(threads) => (StatusCode::OK, Json(threads)).into_response(),
                Err(e) => {
                    eprintln!("Failed to fetch threads for board {}: {}", board_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch threads").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Board not found").into_response(),
        Err(e) => {
            eprintln!("Failed to check board existence: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking board").into_response()
        }
    }
}

/// Handler to update a thread's title.
pub async fn update_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<UpdateThreadPayload>,
) -> Response {
    // Fetch thread first
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread_to_update)) => {
            // Authorization check
            if thread_to_update.created_by != user.0 {
                return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }

            // Construct update data
            let update_data = UpdateThreadData { title: payload.title };

            // Perform update
            match thread_repository::update_thread(&state.db_pool, thread_id, update_data).await {
                Ok(Some(updated_thread)) => (StatusCode::OK, Json(updated_thread)).into_response(),
                Ok(None) => (StatusCode::NOT_FOUND, "Thread not found during update").into_response(), // Should be rare
                Err(e) => {
                    eprintln!("Failed to update thread: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update thread").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            eprintln!("Failed to fetch thread for update: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching thread for update").into_response()
        }
    }
}

/// Handler to delete a thread.
pub async fn delete_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
) -> Response {
    // Fetch thread first
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread_to_delete)) => {
            // Authorization check
            if thread_to_delete.created_by != user.0 {
                 return (StatusCode::FORBIDDEN, "Permission denied").into_response();
            }
            
            // Perform delete
            match thread_repository::delete_thread(&state.db_pool, thread_id).await {
                 Ok(0) => (StatusCode::NOT_FOUND, "Thread not found during delete").into_response(), // Should be rare
                 Ok(_) => (StatusCode::NO_CONTENT).into_response(), // Success (1 row deleted)
                 Err(e) => {
                    eprintln!("Failed to delete thread: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete thread").into_response()
                 }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            eprintln!("Failed to fetch thread for delete: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching thread for delete").into_response()
        }
    }
}

// Restore UpdateThreadPayload definition
#[derive(Deserialize)]
pub struct UpdateThreadPayload {
    title: String,
} 