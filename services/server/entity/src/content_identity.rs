use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "content_identity")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // Identity key (sha256 hash of the initial Identity content)
    pub identity: String,

    // Serialized Identity proto bytes (contains rotation_keys and signing_keys)
    pub identity_bytes: Vec<u8>,

    // Identity document fields, decoded to queryable columns.
    // Keys are `[{"key_type": <i32>, "key": "<hex>"}]`.
    #[sea_orm(column_type = "JsonBinary")]
    pub rotation_keys: Json,
    #[sea_orm(column_type = "JsonBinary")]
    pub signing_keys: Json,
    #[sea_orm(column_type = "JsonBinary")]
    pub revocation_bounds: Json,
    // Null when the identity has never configured a server list — distinct
    // from an intentionally empty list.
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub servers: Option<Json>,
}

impl ActiveModelBehavior for ActiveModel {}
