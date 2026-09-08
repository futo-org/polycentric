use sea_orm::entity::prelude::*;

/// Verification schemas, deduplicated by digest. A claim's
/// `schema_digest_*` references a row here.
// No `Eq`: `Json` (serde_json::Value) isn't `Eq`.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "verification_schema")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub digest_type: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub digest_bytes: Vec<u8>,

    // Canonical serialized VerificationSchema.
    pub schema_bytes: Vec<u8>,
    // Decoded VerificationSchema as a queryable jsonb object.
    #[sea_orm(column_type = "JsonBinary")]
    pub schema: Json,
}

impl ActiveModelBehavior for ActiveModel {}
