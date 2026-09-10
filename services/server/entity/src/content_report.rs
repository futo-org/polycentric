use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_report")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // ReportCategory enum value
    pub category: i16,
    // Free-text context supplied by the reporter
    pub additional_info: String,

    // EventKey of the event being reported
    pub event_key_collection: i16,
    pub event_key_identity: String,
    pub event_key_public_key_type: i16,
    pub event_key_public_key: Vec<u8>,
    pub event_key_sequence: i64,
}

impl ActiveModelBehavior for ActiveModel {}
