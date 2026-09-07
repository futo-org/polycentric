use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "events")]
pub struct Model {
    // ID used on the server for relations only. This is not the Event Key or used on clients.
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,

    ////
    // Start: Event Key
    ////
    // Collection the event belongs to (1=Identity, 2=Feed, 3=Interactions)
    #[sea_orm(unique_key = "event_key")]
    pub collection: i16,
    // Identity key (sha256 hash of the initial Identity content)
    #[sea_orm(unique_key = "event_key")]
    pub identity: String,
    #[sea_orm(unique_key = "event_key")]
    pub public_key_type: i16,
    #[sea_orm(unique_key = "event_key")]
    pub public_key: Vec<u8>,
    #[sea_orm(unique_key = "event_key")]
    pub sequence: i64,
    ////
    // End: Event Key
    ////

    // Content digest (denormalized for joining to content table, optional)
    pub content_digest_type: Option<i32>,
    pub content_digest_bytes: Option<Vec<u8>>,

    // Signatures
    pub signature: Vec<u8>,
    pub previous_signature: Vec<u8>,

    // Merkle root over this signer's canonical (identity, collection) history
    // as known at sign time. Denormalized from event_bytes for proof lookups.
    pub previous_root: Vec<u8>,

    // Application that created the event (`application` table), denormalized
    // from event_bytes.
    pub application_id: Option<i32>,

    // We need to store the raw event due to non-deterministic serialization
    pub event_bytes: Vec<u8>,

    // Timestamp the client created the event
    pub created_at: DateTimeWithTimeZone,
    // Timestamp the server received the event
    pub synced_at: DateTimeWithTimeZone,

    /// Only if this is a follow event.
    #[sea_orm(has_one)] // Really has zero or one.
    pub follow: HasOne<super::follow_model::Entity>,
    /// Only if this is a block event.
    #[sea_orm(has_one)] // Really has zero or one.
    pub block: HasOne<super::block_model::Entity>,
    /// Only if this is a post event.
    #[sea_orm(has_one)] // Really has zero or one.
    pub reaction_tally: HasOne<super::reaction_tally_model::Entity>,
    /// Only if this is a reaction event.
    #[sea_orm(has_one)] // Really has zero or one.
    pub reaction: HasOne<super::reaction_model::Entity>,
    /// Only if this is a repost event.
    #[sea_orm(has_one)] // Really has zero or one.
    pub repost: HasOne<super::repost_model::Entity>,
    /// Only if this a post event that quotes another post.
    #[sea_orm(has_one)] // Really has zero or one.
    pub quote: HasOne<super::quote_model::Entity>,
    /// Only if this a post event that replies to another post.
    #[sea_orm(has_one)] // Really has zero or one.
    pub reply: HasOne<super::reply_model::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
