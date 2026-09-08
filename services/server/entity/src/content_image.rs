use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_image")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // Blob digest (no FK — resolved via query)
    pub blob_digest_type: i16,
    pub blob_digest_bytes: Vec<u8>,

    pub width: i32,
    pub height: i32,
}

impl ActiveModelBehavior for ActiveModel {}
