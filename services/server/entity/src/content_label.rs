use sea_orm::entity::prelude::*;

/// One row per label value applied to a piece of content (a `Labels`
/// event). Storing labels one-per-row keeps aggregations (counts/group-by
/// over `label_value`) efficient. The labeled event's key is denormalized
/// onto each row.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_label")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // A single label value, e.g. "sexually-suggestive" or "hate".
    #[sea_orm(primary_key, auto_increment = false)]
    pub label_value: String,

    // EventKey of the event being labeled.
    pub event_key_collection: i16,
    pub event_key_identity: String,
    pub event_key_public_key_type: i16,
    pub event_key_public_key: Vec<u8>,
    pub event_key_sequence: i64,
}

impl ActiveModelBehavior for ActiveModel {}
