use crate::{
    auth::{AdminUser, AuthenticatedUser},
    constants::{MAX_POST_CONTENT_LENGTH, MAX_THREAD_TITLE_LENGTH},
    repositories::{
        self, board_repository,
        thread_repository::{self, UpdateThreadData},
    },
    utils::PaginationParams,
    AppState,
};
use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Deserialize;
use tracing::{error, info, warn};
use uuid::Uuid;

const MAX_IMAGES_PER_POST: usize = 5;
const MAX_IMAGE_SIZE_MB: u64 = 10;
const MAX_IMAGE_SIZE_BYTES: u64 = MAX_IMAGE_SIZE_MB * 1024 * 1024;

#[derive(Debug)]
struct TempImageField {
    filename: Option<String>,
    data: Vec<u8>,
}

pub async fn create_thread_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    user: AuthenticatedUser,
    mut multipart: Multipart,
) -> Response {
    let created_by = user.0;

    let mut collected_title: Option<String> = None;
    let mut collected_content: Option<String> = None;
    let mut collected_images: Vec<TempImageField> = Vec::new();
    let mut collected_system_id_b64: Option<String> = None;
    let mut collected_process_id_b64: Option<String> = None;
    let mut collected_log_seq_str: Option<String> = None;

    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let field_name = match field.name() {
                    Some(name) => name.to_string(),
                    None => continue,
                };

                match field_name.as_str() {
                    "title" => match field.bytes().await {
                        Ok(data) => match String::from_utf8(data.to_vec()) {
                            Ok(s) => collected_title = Some(s),
                            Err(_) => {
                                return (StatusCode::BAD_REQUEST, "Invalid UTF-8 in title field")
                                    .into_response()
                            }
                        },
                        Err(e) => {
                            return (
                                StatusCode::BAD_REQUEST,
                                format!("Failed to read title field: {}", e),
                            )
                                .into_response()
                        }
                    },
                    "content" => match field.bytes().await {
                        Ok(data) => match String::from_utf8(data.to_vec()) {
                            Ok(s) => collected_content = Some(s),
                            Err(_) => {
                                return (StatusCode::BAD_REQUEST, "Invalid UTF-8 in content field")
                                    .into_response()
                            }
                        },
                        Err(e) => {
                            return (
                                StatusCode::BAD_REQUEST,
                                format!("Failed to read content field: {}", e),
                            )
                                .into_response()
                        }
                    },
                    "image" => {
                        if collected_images.len() >= MAX_IMAGES_PER_POST {
                            return (
                                StatusCode::BAD_REQUEST,
                                format!(
                                    "Exceeded maximum number of images ({})",
                                    MAX_IMAGES_PER_POST
                                ),
                            )
                                .into_response();
                        }
                        let filename = field.file_name().map(|s| s.to_string());
                        match field.bytes().await {
                            Ok(data) => {
                                if data.len() as u64 > MAX_IMAGE_SIZE_BYTES {
                                    return (
                                        StatusCode::PAYLOAD_TOO_LARGE,
                                        format!(
                                            "Image size exceeds limit ({} MB)",
                                            MAX_IMAGE_SIZE_MB
                                        ),
                                    )
                                        .into_response();
                                }
                                collected_images.push(TempImageField {
                                    filename,
                                    data: data.to_vec(),
                                });
                            }
                            Err(e) => {
                                return (
                                    StatusCode::BAD_REQUEST,
                                    format!("Failed to read image data: {}", e),
                                )
                                    .into_response()
                            }
                        }
                    }
                    "polycentric_system_id" => match field.bytes().await {
                        Ok(data) => collected_system_id_b64 = String::from_utf8(data.to_vec()).ok(),
                        Err(_) => {
                            return (
                                StatusCode::BAD_REQUEST,
                                "Failed to read polycentric_system_id",
                            )
                                .into_response()
                        }
                    },
                    "polycentric_process_id" => match field.bytes().await {
                        Ok(data) => {
                            collected_process_id_b64 = String::from_utf8(data.to_vec()).ok()
                        }
                        Err(_) => {
                            return (
                                StatusCode::BAD_REQUEST,
                                "Failed to read polycentric_process_id",
                            )
                                .into_response()
                        }
                    },
                    "polycentric_log_seq" => match field.bytes().await {
                        Ok(data) => collected_log_seq_str = String::from_utf8(data.to_vec()).ok(),
                        Err(_) => {
                            return (
                                StatusCode::BAD_REQUEST,
                                "Failed to read polycentric_log_seq",
                            )
                                .into_response()
                        }
                    },
                    _ => { /* Ignore other fields */ }
                }
            }
            Ok(None) => break,
            Err(e) => {
                warn!(error = %e, "Multipart processing error");
                if e.to_string().contains("body limit exceeded") {
                    return (
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "Total upload size limit exceeded",
                    )
                        .into_response();
                }
                return (
                    StatusCode::BAD_REQUEST,
                    format!("Multipart processing error: {}", e),
                )
                    .into_response();
            }
        }
    }

    let title = match collected_title {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                "Missing or empty required field: title",
            )
                .into_response()
        }
    };
    let content = match collected_content {
        Some(c) if !c.trim().is_empty() => c.trim().to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                "Missing or empty required field: content",
            )
                .into_response()
        }
    };

    if title.chars().count() > MAX_THREAD_TITLE_LENGTH {
        return (
            StatusCode::BAD_REQUEST,
            format!(
                "Title exceeds maximum length of {} characters",
                MAX_THREAD_TITLE_LENGTH
            ),
        )
            .into_response();
    }
    if content.chars().count() > MAX_POST_CONTENT_LENGTH {
        return (
            StatusCode::BAD_REQUEST,
            format!(
                "Content exceeds maximum length of {} characters",
                MAX_POST_CONTENT_LENGTH
            ),
        )
            .into_response();
    }

    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(_)) => { /* Board exists */ }
        Ok(None) => return (StatusCode::NOT_FOUND, "Board not found").into_response(),
        Err(e) => {
            error!(error = %e, board_id = %board_id, "Error checking board existence during thread creation");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Error checking board existence",
            )
                .into_response();
        }
    }

    let mut image_urls: Vec<String> = Vec::new();
    for image_field in collected_images {
        let filename_for_log = image_field.filename.clone();
        match state
            .image_storage
            .save_image(image_field.data.into(), image_field.filename)
            .await
        {
            Ok(url) => image_urls.push(url),
            Err(e) => {
                error!(error = %e, image_filename = ?filename_for_log, "Failed to save image during thread creation");
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save image").into_response();
            }
        }
    }

    let mut thread_data = repositories::thread_repository::CreateThreadData {
        title,
        content,
        created_by,
        images: if image_urls.is_empty() {
            None
        } else {
            Some(image_urls)
        },
        polycentric_system_id: None,
        polycentric_process_id: None,
        polycentric_log_seq: None,
    };

    let has_system = collected_system_id_b64.is_some();
    let has_process = collected_process_id_b64.is_some();
    let has_seq = collected_log_seq_str.is_some();

    if (has_system || has_process || has_seq) && !(has_system && has_process && has_seq) {
        return (
            StatusCode::BAD_REQUEST,
            "Polycentric pointer fields must be provided together or not at all.",
        )
            .into_response();
    }

    if has_system && has_process && has_seq {
        thread_data.polycentric_system_id =
            match BASE64_STANDARD.decode(collected_system_id_b64.unwrap()) {
                Ok(id) => Some(id),
                Err(_) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        "Invalid base64 for polycentric_system_id",
                    )
                        .into_response()
                }
            };
        thread_data.polycentric_process_id =
            match BASE64_STANDARD.decode(collected_process_id_b64.unwrap()) {
                Ok(id) => Some(id),
                Err(_) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        "Invalid base64 for polycentric_process_id",
                    )
                        .into_response()
                }
            };
        thread_data.polycentric_log_seq = match collected_log_seq_str.unwrap().parse::<i64>() {
            Ok(seq) => Some(seq),
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    "Invalid number format for polycentric_log_seq",
                )
                    .into_response()
            }
        };
    }

    match thread_repository::create_thread_with_initial_post(&state.db_pool, board_id, thread_data)
        .await
    {
        Ok(created_info) => {
            info!(thread_id = %created_info.thread.id, post_id = %created_info.initial_post_id, board_id = %board_id, created_by = ?created_info.thread.created_by, "Successfully created thread");
            (StatusCode::CREATED, Json(created_info)).into_response()
        }
        Err(e) => {
            error!(error = %e, board_id = %board_id, "Failed to create thread in database");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create thread").into_response()
        }
    }
}

pub async fn get_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
) -> Response {
    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread)) => (StatusCode::OK, Json(thread)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "Thread not found").into_response(),
        Err(e) => {
            error!(error = %e, thread_id = %thread_id, "Failed to fetch thread");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch thread").into_response()
        }
    }
}

pub async fn list_threads_in_board_handler(
    State(state): State<AppState>,
    Path(board_id): Path<Uuid>,
    Query(pagination): Query<PaginationParams>,
) -> Response {
    match board_repository::get_board_by_id(&state.db_pool, board_id).await {
        Ok(Some(_)) => {
            match thread_repository::get_threads_by_board(&state.db_pool, board_id, &pagination)
                .await
            {
                Ok(threads) => (StatusCode::OK, Json(threads)).into_response(),
                Err(e) => {
                    error!(error = %e, board_id = %board_id, "Failed to fetch threads for board");
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch threads").into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Board not found").into_response(),
        Err(e) => {
            error!(error = %e, board_id = %board_id, "Error checking board existence before listing threads");
            (StatusCode::INTERNAL_SERVER_ERROR, "Error checking board").into_response()
        }
    }
}

pub async fn update_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<UpdateThreadPayload>,
) -> Response {
    if payload.title.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Title cannot be empty").into_response();
    }
    if payload.title.trim().chars().count() > MAX_THREAD_TITLE_LENGTH {
        return (
            StatusCode::BAD_REQUEST,
            format!(
                "Title exceeds maximum length of {} characters",
                MAX_THREAD_TITLE_LENGTH
            ),
        )
            .into_response();
    }

    match thread_repository::get_thread_by_id(&state.db_pool, thread_id).await {
        Ok(Some(thread_to_update)) => {
            if thread_to_update.created_by != user.0 {
                warn!(thread_id = %thread_id, user_pubkey = ?user.0, actual_author = ?thread_to_update.created_by, "User attempted to update thread they did not create");
                return (
                    StatusCode::FORBIDDEN,
                    "You can only update your own threads.",
                )
                    .into_response();
            }
            let update_data = UpdateThreadData {
                title: payload.title,
            };

            match thread_repository::update_thread(&state.db_pool, thread_id, update_data).await {
                Ok(Some(updated_thread)) => {
                    info!(thread_id = %updated_thread.id, "Successfully updated thread title");
                    (StatusCode::OK, Json(updated_thread)).into_response()
                }
                Ok(None) => {
                    (StatusCode::NOT_FOUND, "Thread not found during update").into_response()
                }
                Err(e) => {
                    error!(error = %e, thread_id = %thread_id, "Failed to update thread title in database");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to update thread title.",
                    )
                        .into_response()
                }
            }
        }
        Ok(None) => {
            warn!(thread_id = %thread_id, user_pubkey = ?user.0, "User attempted to update non-existent thread");
            (StatusCode::NOT_FOUND, "Thread not found.").into_response()
        }
        Err(e) => {
            error!(error = %e, thread_id = %thread_id, "Failed to check thread author before update");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to check thread author.",
            )
                .into_response()
        }
    }
}

pub async fn delete_thread_handler(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
    admin_user: Option<AdminUser>,
    auth_user: Option<AuthenticatedUser>,
) -> Response {
    let is_admin = admin_user.is_some();
    let mut requesting_user_pubkey: Option<Vec<u8>> = None;

    if !is_admin {
        match auth_user {
            Some(user) => {
                requesting_user_pubkey = Some(user.0);
            }
            None => {
                warn!(thread_id = %thread_id, "Unauthenticated attempt to delete thread");
                return (StatusCode::UNAUTHORIZED, "Authentication required.").into_response();
            }
        }
    }

    let author_id = match thread_repository::get_thread_author(&state.db_pool, thread_id).await {
        Ok(Some(id)) => id,
        Ok(None) => {
            warn!(thread_id = %thread_id, deleted_by_admin = is_admin, user_pubkey = ?requesting_user_pubkey, "Attempted to delete non-existent thread");
            return (StatusCode::NOT_FOUND, "Thread not found").into_response();
        }
        Err(e) => {
            error!(error = %e, thread_id = %thread_id, "Failed to fetch thread author for deletion check");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Database error fetching author",
            )
                .into_response();
        }
    };

    let can_delete = if is_admin {
        true
    } else if let Some(ref pubkey) = requesting_user_pubkey {
        *pubkey == author_id
    } else {
        false
    };

    if can_delete {
        let log_pubkey_ref = requesting_user_pubkey.as_ref();
        match thread_repository::delete_thread_with_posts(&state.db_pool, thread_id).await {
            Ok(0) => {
                warn!(thread_id = %thread_id, deleted_by_admin = is_admin, user_pubkey = ?log_pubkey_ref, "Attempted delete, but thread not found during delete operation");
                (StatusCode::NOT_FOUND, "Thread not found during delete").into_response()
            }
            Ok(_) => {
                info!(thread_id = %thread_id, deleted_by_admin = is_admin, user_pubkey = ?log_pubkey_ref, "Successfully deleted thread");
                (StatusCode::NO_CONTENT).into_response()
            }
            Err(e) => {
                error!(error = %e, thread_id = %thread_id, deleted_by_admin = is_admin, user_pubkey = ?log_pubkey_ref, "Failed to delete thread from database");
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete thread").into_response()
            }
        }
    } else {
        warn!(thread_id = %thread_id, user_pubkey = ?requesting_user_pubkey, actual_author = ?author_id, "User attempted to delete thread they did not create");
        (StatusCode::FORBIDDEN, "Permission denied").into_response()
    }
}

#[derive(Deserialize)]
pub struct UpdateThreadPayload {
    title: String,
}
