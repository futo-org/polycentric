use crate::auth::{AdminUser, AuthenticatedUser};
use crate::{
    repositories::user_repository::{self, BanUserData},
    AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use tracing::{error, info};

/// Get all users who have posted on the forum
pub async fn get_all_users_handler(State(state): State<AppState>, _admin: AdminUser) -> Response {
    match user_repository::get_all_users(&state.db_pool).await {
        Ok(users) => (StatusCode::OK, Json(users)).into_response(),
        Err(e) => {
            error!(error = %e, "Failed to fetch users");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch users").into_response()
        }
    }
}

/// Get all banned users
pub async fn get_banned_users_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Response {
    match user_repository::get_banned_users(&state.db_pool).await {
        Ok(banned_users) => (StatusCode::OK, Json(banned_users)).into_response(),
        Err(e) => {
            error!(error = %e, "Failed to fetch banned users");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch banned users",
            )
                .into_response()
        }
    }
}

/// Ban a user
pub async fn ban_user_handler(
    State(state): State<AppState>,
    admin: AdminUser,
    Json(ban_data): Json<BanUserData>,
) -> Response {
    // Check if user is already banned
    match user_repository::is_user_banned(&state.db_pool, &ban_data.public_key).await {
        Ok(true) => {
            return (StatusCode::CONFLICT, "User is already banned").into_response();
        }
        Ok(false) => {
            // Continue with banning
        }
        Err(e) => {
            error!(error = %e, "Failed to check if user is banned");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to check user ban status",
            )
                .into_response();
        }
    }

    match user_repository::ban_user(
        &state.db_pool,
        &ban_data.public_key,
        &admin.0 .0,
        ban_data.reason.as_deref(),
    )
    .await
    {
        Ok(banned_user) => {
            info!(user_pubkey = ?ban_data.public_key, banned_by = ?admin.0, "User banned successfully");
            (StatusCode::OK, Json(banned_user)).into_response()
        }
        Err(e) => {
            error!(error = %e, user_pubkey = ?ban_data.public_key, "Failed to ban user");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to ban user").into_response()
        }
    }
}

/// Unban a user
pub async fn unban_user_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(public_key_b64): Path<String>,
) -> Response {
    let public_key = match BASE64_STANDARD.decode(&public_key_b64) {
        Ok(key) => key,
        Err(_) => {
            return (StatusCode::BAD_REQUEST, "Invalid public key format").into_response();
        }
    };

    match user_repository::unban_user(&state.db_pool, &public_key).await {
        Ok(rows_affected) => {
            if rows_affected == 0 {
                (StatusCode::NOT_FOUND, "User not found or not banned").into_response()
            } else {
                info!(user_pubkey = ?public_key, "User unbanned successfully");
                (StatusCode::OK, "User unbanned successfully").into_response()
            }
        }
        Err(e) => {
            error!(error = %e, user_pubkey = ?public_key, "Failed to unban user");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to unban user").into_response()
        }
    }
}

/// Check if current user is banned
pub async fn check_ban_status_handler(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> Response {
    match user_repository::is_user_banned(&state.db_pool, &user.0).await {
        Ok(true) => {
            // Get ban details
            match user_repository::get_banned_user(&state.db_pool, &user.0).await {
                Ok(Some(ban_info)) => {
                    let response = serde_json::json!({
                        "banned": true,
                        "reason": ban_info.reason,
                        "banned_at": ban_info.created_at
                    });
                    (StatusCode::FORBIDDEN, Json(response)).into_response()
                }
                Ok(None) => {
                    // This shouldn't happen, but handle it gracefully
                    (
                        StatusCode::FORBIDDEN,
                        Json(serde_json::json!({"banned": true})),
                    )
                        .into_response()
                }
                Err(e) => {
                    error!(error = %e, "Failed to get ban details");
                    (
                        StatusCode::FORBIDDEN,
                        Json(serde_json::json!({"banned": true})),
                    )
                        .into_response()
                }
            }
        }
        Ok(false) => (StatusCode::OK, Json(serde_json::json!({"banned": false}))).into_response(),
        Err(e) => {
            error!(error = %e, "Failed to check ban status");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to check ban status",
            )
                .into_response()
        }
    }
}
