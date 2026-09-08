use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_blob")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // The data of a 'blob' is stored on block storage, not here.
    // We simply reference them.
    #[sea_orm(unique_key = "digest")]
    pub digest_type: i16,
    #[sea_orm(unique_key = "digest")]
    pub digest_bytes: Vec<u8>,

    pub mime_type: String,
    pub size: i64,
    // Maybe the server may need some additional flags such as if it was uploaded or received
}

impl ActiveModelBehavior for ActiveModel {}
