use sea_orm::entity::prelude::*;

/// Each row stores one claimer for a pairing session.
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "pairing_session_claimer")]
pub struct Model {
    /// Identifies which pairing session the claimer has joined.
    #[sea_orm(primary_key, auto_increment = false)]
    pub digest_sha256: Vec<u8>,

    // Claimer's public key
    #[sea_orm(primary_key, auto_increment = false)]
    pub claimer_key_type: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub claimer_key: Vec<u8>,

    /// Indexed column of the issuer's identity for efficient lookup.
    #[sea_orm(indexed)]
    pub issuer_identity: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
