use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;
use crate::{
    models::Post,
    repositories::{post_repository::{self, CreatePostData, UpdatePostData}, thread_repository}, // Import post and thread repos
    utils::PaginationParams, // Import
    AppState,
};
use axum::extract::multipart::MultipartError;
use multer::Error as MulterError;
use std::error::Error;

/// Handler to create a new post with optional image uploads (multipart/form-data).
pub async fn create_post_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    mut multipart: Multipart, // Expect multipart form data
) -> Response {
    // Limits
    const MAX_IMAGES_PER_POST: usize = 5;

    // Placeholders for extracted data
    let mut author_id_opt: Option<String> = None;
    let mut content_opt: Option<String> = None;
    let mut quote_of_opt: Option<Uuid> = None;
    let mut image_urls: Vec<String> = Vec::new();
    let mut image_count: usize = 0; // Counter for images

    // Process multipart stream using next_field()
    while let Some(field) = match multipart.next_field().await {
        Ok(field_option) => field_option,
        Err(e) => {
            // Check if the error is due to the overall body size limit layer (based on string)
            if e.to_string().contains("body limit exceeded") { // Check layer limit
                 return (StatusCode::PAYLOAD_TOO_LARGE, "Total upload size limit exceeded").into_response();
            }
            
            // Treat other multipart stream processing errors as Bad Request
            return (StatusCode::BAD_REQUEST, format!("Multipart parsing error: {}", e)).into_response();
        }
    } {
        // Got a field successfully (inside the Some(field) block)
        let field_name = match field.name() {
            Some(name) => name.to_string(),
            None => continue, // Skip fields without names
        };

        if field_name == "image" { // Assuming image files have field name "image"
            // Check image count limit
            if image_count >= MAX_IMAGES_PER_POST {
                return (StatusCode::BAD_REQUEST, format!("Exceeded maximum number of images ({})", MAX_IMAGES_PER_POST)).into_response();
            }
            image_count += 1;

            let original_filename = field.file_name().map(|s| s.to_string());
            match field.bytes().await { // This reads the whole field into memory
                Ok(bytes) => {
                    // Check individual file size 
                    const MAX_IMAGE_SIZE: usize = 10 * 1024 * 1024; // 10 MB limit
                    if bytes.len() > MAX_IMAGE_SIZE {
                         eprintln!("Uploaded image {} exceeded size limit: {} > {}", 
                                  original_filename.as_deref().unwrap_or("[unknown]"), 
                                  bytes.len(), MAX_IMAGE_SIZE);
                        return (StatusCode::PAYLOAD_TOO_LARGE, format!("Individual image size cannot exceed {}MB", MAX_IMAGE_SIZE / (1024 * 1024))).into_response();
                    }

                    match state.image_storage.save_image(bytes, original_filename).await {
                        Ok(url) => image_urls.push(url),
                        Err(e) => {
                            eprintln!("Failed to save image: {}", e);
                            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save uploaded image").into_response();
                        }
                    }
                }
                Err(e) => {
                    // This error could also be due to size limits if stream reading fails partway
                    eprintln!("Failed to read image bytes: {}", e);
                    return (StatusCode::BAD_REQUEST, "Failed to read image data").into_response();
                }
            }
        } else {
            // Handle text fields
            match field.text().await {
                Ok(text) => {
                    // DEBUG: Log received text field name and value - REMOVE THIS
                    // eprintln!("[create_post_handler DEBUG] Received text field: name=\"{}\", value=\"{}\"", field_name, text);
                    // END DEBUG
                    match field_name.as_str() {
                        "author_id" => author_id_opt = Some(text),
                        "content" => content_opt = Some(text),
                        "quote_of" => {
                            // Only attempt to parse if the text is not empty
                            if !text.is_empty() { 
                                match Uuid::parse_str(&text) {
                                    Ok(uuid) => quote_of_opt = Some(uuid),
                                    Err(_) => {
                                        // Return Bad Request only if parsing fails on non-empty string
                                        eprintln!("Invalid quote_of UUID format received: {}", text);
                                        return (StatusCode::BAD_REQUEST, "Invalid quote_of UUID format").into_response();
                                    }
                                }
                            } 
                            // If text is empty, simply leave quote_of_opt as None
                        }
                        _ => { /* Ignore unknown fields */ }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to read text field '{}': {}", field_name, e);
                    return (StatusCode::BAD_REQUEST, format!("Failed to read field: {}", field_name)).into_response();
                }
            }
        }
    }

    // Validate required fields
    let (Some(author_id), Some(content)) = (author_id_opt, content_opt) else {
        return (StatusCode::BAD_REQUEST, "Missing required fields (author_id, content)").into_response();
    };

    // Construct payload for repository
    let payload = CreatePostData {
        author_id,
        content,
        quote_of: quote_of_opt,
        images: if image_urls.is_empty() { None } else { Some(image_urls) },
    };

    // Now proceed with checking thread/quote existence and creating the post
    // (Similar logic as before, but using the constructed payload)
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(_)) => {
            if let Some(quote_id) = payload.quote_of {
                match post_repository::get_post_by_id(&state.db_pool, quote_id).await {
                    Ok(Some(_)) => { /* Quoted post exists */ }
                    Ok(None) => return (StatusCode::BAD_REQUEST, "Quoted post not found").into_response(),
                    Err(e) => {
                        eprintln!("Failed to check quoted post existence: {}", e);
                        return (StatusCode::INTERNAL_SERVER_ERROR, "Error checking quoted post").into_response();
                    }
                }
            }

            match post_repository::create_post(&state.db_pool, thread_id, payload).await {
                Ok(new_post) => (StatusCode::CREATED, Json(new_post)).into_response(),
                Err(e) => {
                    eprintln!("Failed to create post: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create post").into_response()
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

/// Handler to list all posts within a specific thread with pagination.
pub async fn list_posts_in_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    Query(pagination): Query<PaginationParams>, // Extract pagination
) -> Response {
    // Optional: Check if thread exists first
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(_)) => {
            // Thread exists, proceed to list posts
            match post_repository::get_posts_by_thread(&state.db_pool, thread_id, &pagination).await {
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