use sea_orm::entity::prelude::*;

/// One row per `VerificationClaim` event.
// No `Eq`: `Json` (serde_json::Value) isn't `Eq`.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "content_verification_claim")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // Schema digest, for grouping claims of the same schema.
    pub schema_digest_type: i32,
    pub schema_digest_bytes: Vec<u8>,

    // Claim fields, decoded per the schema, as a queryable jsonb object.
    #[sea_orm(column_type = "JsonBinary")]
    pub fields: Json,
}

impl ActiveModelBehavior for ActiveModel {}
