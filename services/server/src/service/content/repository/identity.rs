use crate::service::proto::{Identity, PublicKey, RevocationBound};
use entity::content_identity;
use prost::Message;
use sea_orm::DbErr;
use sea_orm::sea_query::{DynIden, Expr, InsertStatement, SelectStatement};
use serde_json::json;
use tonic::Status;

pub(super) fn add_query(
    identity: Identity,
    content_id: (DynIden, DynIden),
    event_identity: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let encoded_identity = identity.encode_to_vec();
    let Identity {
        rotation_keys,
        signing_keys,
        revocation_bounds,
        servers,
        recovery_key: _,
        recovery_signature: _,
    } = identity;

    let mut query = InsertStatement::new();
    query
        .into_table(content_identity::Entity)
        .columns([
           content_identity::Column::ContentId,
           content_identity::Column::Identity,
           content_identity::Column::IdentityBytes,
           content_identity::Column::RotationKeys,
           content_identity::Column::SigningKeys,
           content_identity::Column::RevocationBounds,
           content_identity::Column::Servers,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q
                .from(content_id.0.clone())
                .from(event_identity.0.clone())
                .expr(Expr::col(content_id))
                .expr(Expr::col(event_identity))
                .expr(Expr::from(encoded_identity))
                .expr(Expr::from(keys_to_json(&rotation_keys)))
                .expr(Expr::from(keys_to_json(&signing_keys)))
                .expr(Expr::from(revocation_bounds_to_json(&revocation_bounds)))
                .expr(Expr::from(servers.map(|s| json!(s.urls))));
           q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store identity content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}

fn key_to_json(key: &PublicKey) -> serde_json::Value {
    json!({
        "key_type": key.key_type,
        "key": hex::encode(&key.key),
    })
}

fn keys_to_json(keys: &[PublicKey]) -> serde_json::Value {
    serde_json::Value::Array(keys.iter().map(key_to_json).collect())
}

fn revocation_bounds_to_json(bounds: &[RevocationBound]) -> serde_json::Value {
    serde_json::Value::Array(
        bounds
            .iter()
            .map(|b| {
                json!({
                    "revoked_key": b.revoked_key.as_ref().map(key_to_json),
                    "targets": b
                        .targets
                        .iter()
                        .map(|t| json!({
                            "collection": t.collection,
                            "signature": hex::encode(&t.signature),
                            "root": hex::encode(&t.root),
                            "leaf_count": t.leaf_count,
                        }))
                        .collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}
