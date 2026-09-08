use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "reaction_tallies")]
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
    /// The emoji this tally is for.
    #[sea_orm(primary_key, auto_increment = false)]
    pub emoji: String,
    /// Whether this tally is for positive or negative reactions.
    #[sea_orm(primary_key, auto_increment = false)]
    pub positive: bool,
    /// Our estimate for how many times this (emoji, positive) reaction was given.
    pub count: i64,
}

impl ActiveModelBehavior for ActiveModel {}
