use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_post")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // Main text content of the post
    pub text: String,

    // Optional reply context (EventKey fields stored inline)
    // Root of the reply chain
    pub reply_root_collection: Option<i16>,
    pub reply_root_identity: Option<String>,
    pub reply_root_public_key_type: Option<i16>,
    pub reply_root_public_key: Option<Vec<u8>>,
    pub reply_root_sequence: Option<i64>,
    // Direct parent being replied to
    pub reply_parent_collection: Option<i16>,
    pub reply_parent_identity: Option<String>,
    pub reply_parent_public_key_type: Option<i16>,
    pub reply_parent_public_key: Option<Vec<u8>>,
    pub reply_parent_sequence: Option<i64>,

    // Optional quoted-post EventKey (mirrors the reply_parent_* shape).
    pub quote_collection: Option<i16>,
    pub quote_identity: Option<String>,
    pub quote_public_key_type: Option<i16>,
    pub quote_public_key: Option<Vec<u8>>,
    pub quote_sequence: Option<i64>,
}

impl ActiveModelBehavior for ActiveModel {}
