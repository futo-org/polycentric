use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "reaction_summaries")]
pub struct Model {
    // --- event key ---
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_key_collection: i16,
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_key_identity: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_key_public_key_type: i16,
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_key_public_key: Vec<u8>,
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_key_sequence: i64,
    // --- end event key ---
    /// Our estimate for the number of positive reactions the event has.
    pub upvote_count: i64,
    /// Our estimate for the number of negative reactions the event has.
    pub downvote_count: i64,
}

impl ActiveModelBehavior for ActiveModel {}
