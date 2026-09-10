use sea_orm::entity::prelude::*;

/// One row per identity in a `VerificationTarget` event. Targeting is a
/// separate event from the claim, so the targeted claim's EventKey is
/// denormalized here.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_verification_target")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    #[sea_orm(primary_key, auto_increment = false)]
    pub target_identity: String,

    // EventKey of the claim being targeted.
    pub claim_event_key_collection: i16,
    pub claim_event_key_identity: String,
    pub claim_event_key_public_key_type: i16,
    pub claim_event_key_public_key: Vec<u8>,
    pub claim_event_key_sequence: i64,
}

impl ActiveModelBehavior for ActiveModel {}
