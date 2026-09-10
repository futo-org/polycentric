use crate::service::proto::{FieldKind, VerificationClaim, VerificationSchema};
use base64::prelude::*;
use entity::{content_verification_claim, verification_schema};
use prost::Message;
use sea_orm::sea_query::{
    CommonTableExpression, DynIden, Expr, InsertStatement, OnConflict,
    SelectStatement, WithClause,
};
use sea_orm::{ActiveValue::Set, DbErr, EntityTrait, QueryTrait};
use std::collections::HashMap;
use tonic::Status;

pub(super) fn add_query(
    with: &mut WithClause,
    claim: VerificationClaim,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, Status> {
    let VerificationClaim { schema, fields } = claim;
    let schema = schema.ok_or_else(|| {
        Status::invalid_argument("verification claim missing schema")
    })?;
    let fields = decode_fields(&schema.schema_bytes, &fields);
    let digest = schema.digest.ok_or_else(|| {
        Status::invalid_argument("verification claim missing schema digest")
    })?;

    // Store the schema once, keyed by digest; a conflict means it already
    // exists, so treat that as a no-op.
    let schema_json =
        VerificationSchema::decode(schema.schema_bytes.as_slice())
            .map(|s| schema_to_json(&s))
            .unwrap_or(serde_json::Value::Null);
    let insert_schema =
        verification_schema::Entity::insert(verification_schema::ActiveModel {
            digest_type: Set(digest.r#type),
            digest_bytes: Set(digest.value.clone()),
            schema_bytes: Set(schema.schema_bytes.clone()),
            schema: Set(schema_json),
        })
        .on_conflict(
            OnConflict::columns([
                verification_schema::Column::DigestType,
                verification_schema::Column::DigestBytes,
            ])
            .do_nothing()
            .to_owned(),
        )
        .into_query();
    let mut cte = CommonTableExpression::new();
    cte.table_name("verification_claim_schema")
        .query(insert_schema);
    with.cte(cte);

    let mut query = InsertStatement::new();
    query
        .into_table(content_verification_claim::Entity)
        .columns([
            content_verification_claim::Column::ContentId,
            content_verification_claim::Column::SchemaDigestType,
            content_verification_claim::Column::SchemaDigestBytes,
            content_verification_claim::Column::Fields,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .expr(Expr::col(content_id))
                .expr(Expr::from(digest.r#type))
                .expr(Expr::from(digest.value))
                .expr(Expr::from(fields));
           q
        })
        .map_err(|err| {
            let err = DbErr::Custom(format!("incorrect amount of values: {err}"));
            tracing::error!(error = %err, "failed to create query to store verification claim content");
            Status::internal("internal server error")
        })?;

    Ok(query)
}

/// Decode a claim's `fields` into a JSON object, interpreting each value
/// per its schema `FieldKind`. Fields absent from the schema are skipped;
/// bytes are base64-encoded.
fn decode_fields(
    schema_bytes: &[u8],
    fields: &HashMap<String, Vec<u8>>,
) -> serde_json::Value {
    let Ok(schema) = VerificationSchema::decode(schema_bytes) else {
        return serde_json::Value::Object(serde_json::Map::new());
    };

    let mut object = serde_json::Map::new();
    for field in schema.fields {
        let Some(bytes) = fields.get(&field.key) else {
            continue;
        };
        let value = match FieldKind::try_from(field.kind)
            .unwrap_or(FieldKind::Unspecified)
        {
            FieldKind::String => {
                String::from_utf8_lossy(bytes).into_owned().into()
            }
            FieldKind::Int => {
                let mut buf = [0u8; 8];
                if bytes.len() == 8 {
                    buf.copy_from_slice(bytes);
                }
                i64::from_le_bytes(buf).into()
            }
            FieldKind::Bool => bytes.first().is_some_and(|b| *b != 0).into(),
            FieldKind::Bytes | FieldKind::Unspecified => {
                BASE64_STANDARD.encode(bytes).into()
            }
        };
        object.insert(field.key, value);
    }

    serde_json::Value::Object(object)
}

/// Decode a `VerificationSchema` into a JSON object for querying.
fn schema_to_json(schema: &VerificationSchema) -> serde_json::Value {
    let fields: Vec<serde_json::Value> = schema
        .fields
        .iter()
        .map(|f| {
            serde_json::json!({
                "key": f.key,
                "kind": FieldKind::try_from(f.kind)
                    .unwrap_or(FieldKind::Unspecified)
                    .as_str_name(),
                "format": f.format,
                "required": f.required,
                "description": f.description,
                "regex": f.regex,
                "max_len": f.max_len,
            })
        })
        .collect();

    serde_json::json!({
        "name": schema.name,
        "description": schema.description,
        "fields": fields,
    })
}
