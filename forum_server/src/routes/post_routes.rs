use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::Json,
};
use futures_util::stream::StreamExt; 
use serde::Deserialize;
use uuid::Uuid;
use std::path::Path as StdPath; 
use tokio::fs;
use mime::Mime;
use base64; // Import base64 for printing

use crate::{
    models::{Post, PostImage},
    repositories::post_repository,
    errors::AppError,
    AppState,
    image_storage::{save_image, ImageStorageError},
    auth::AuthenticatedUser,
};

// --- Constants ---
const MAX_IMAGES_PER_POST: usize = 5;
const MAX_IMAGE_SIZE_MB: u64 = 10;
const MAX_IMAGE_SIZE_BYTES: u64 = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// ... ListPostsParams definition ...

// ... list_posts_in_thread_handler ...

// ... get_post_handler ...

// Represents the data expected in the multipart form
#[derive(Debug)]
struct CreatePostData {
    // author_id: String, // Removed, will come from AuthenticatedUser
    content: String,
    quote_of: Option<Uuid>,
    images: Vec<ImageField>,
}

#[derive(Debug)]
struct ImageField {
    filename: Option<String>,
    content_type: Option<Mime>,
    data: Vec<u8>,
}

pub async fn create_post_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Post>), AppError> {
    let author_id = user.0;

    let mut post_data = CreatePostData {
        content: String::new(),
        quote_of: None,
        images: Vec::new(),
    };
    
    while let Some((field_name, field_data, field_filename, field_content_type)) = multipart.next_field().await {
        if let Ok((field_name, field_data, field_filename, field_content_type)) = field_name {
            if field_name == "content" {
                if let Ok(value) = String::from_utf8(field_data) {
                    post_data.content = value;
                } else {
                    return Err(AppError::bad_request("Invalid UTF-8 in content field"));
                }
            } else if field_name == "quote_of" {
                let value_str = String::from_utf8(field_data)
                    .map_err(|_| AppError::bad_request("Invalid UTF-8 in quote_of field"))?;
                if !value_str.is_empty() {
                     match Uuid::parse_str(&value_str) {
                        Ok(uuid) => post_data.quote_of = Some(uuid),
                        Err(_) => return Err(AppError::bad_request("Invalid UUID format for quote_of")),
                    }
                }
            } else if field_name == "image" {
                 if post_data.images.len() >= MAX_IMAGES_PER_POST {
                    return Err(AppError::bad_request(&format!("Exceeded maximum number of images ({})", MAX_IMAGES_PER_POST)));
                }
                 if field_data.len() as u64 > MAX_IMAGE_SIZE_BYTES {
                    return Err(AppError::bad_request(&format!("Image size exceeds limit ({} MB)", MAX_IMAGE_SIZE_MB)));
                }
                post_data.images.push(ImageField {
                    filename: field_filename,
                    content_type: field_content_type,
                    data: field_data,
                });
            } else {
                 eprintln!("Ignoring unknown field: {}", field_name);
            }
        }
    }

    if post_data.content.is_empty() {
        return Err(AppError::bad_request("Missing required field: content"));
    }

    if let Some(quote_id) = post_data.quote_of {
        post_repository::get_post_by_id(&state.db_pool, quote_id).await?;
    }

    let mut image_urls: Vec<String> = Vec::new();
    for image_field in post_data.images {
        let saved_url = save_image(
            &state.image_upload_dir,
            &state.image_base_url,
            image_field.data,
            image_field.content_type,
            image_field.filename,
        )
        .await?;
        image_urls.push(saved_url);
    }

    let post = post_repository::create_post(
        &state.db_pool,
        thread_id,
        &author_id,
        &post_data.content,
        post_data.quote_of,
        image_urls, 
    )
    .await?;

    Ok((StatusCode::CREATED, Json(post)))
}

#[derive(Deserialize)]
pub struct UpdatePostPayload {
    content: String,
}

pub async fn update_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<UpdatePostPayload>,
) -> Result<Json<Post>, AppError> {
    let post_to_update = post_repository::get_post_by_id(&state.db_pool, post_id).await?;

    // Authorization check - Reverted from panic!
    if post_to_update.author_id != user.0 {
        // panic!("PANIC: Update Post Authorization Failed!"); // Reverted
        return Err(AppError::forbidden()); // Return 403 Forbidden
    }

    let post = post_repository::update_post(&state.db_pool, post_id, &payload.content).await?;
    Ok(Json(post))
}

pub async fn delete_post_handler(
    State(state): State<AppState>,
    Path(post_id): Path<Uuid>,
    user: AuthenticatedUser,
) -> Result<StatusCode, AppError> {
    let post_to_delete = post_repository::get_post_by_id(&state.db_pool, post_id).await?;

    // Authorization check - Reverted from panic!
    if post_to_delete.author_id != user.0 {
        // panic!("PANIC: Delete Post Authorization Failed!"); // Reverted
         return Err(AppError::forbidden()); // Return 403 Forbidden
    }
    
    post_repository::delete_post(&state.db_pool, post_id).await?;
    Ok(StatusCode::NO_CONTENT)
}