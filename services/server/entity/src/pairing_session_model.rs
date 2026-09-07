use sea_orm::entity::prelude::*;

/// Ongoing state for a pairing session.
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "pairing_session")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub issuer_identity: String,

    /// SHA256 hash of the serialized `PairingSessionDigest` protobuf message.
    #[sea_orm(unique)]
    pub digest_sha256: Vec<u8>,

    /// Serialized `IssuerPairingState` message signed by the issuer.
    pub issuer_state_bytes: Vec<u8>,

    /// Signature over `issuer_state_bytes` by the `issuer_signer` key in the
    /// digest.
    pub issuer_state_signature: Vec<u8>,

    /// Timestamp this pairing session was created, as declared by the issuer.
    pub initial_timestamp: DateTimeUtc,

    /// Issuer state counter.
    /// Starts at 1 and gets incremented for each state update for this pairing
    /// session.
    pub sequence: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
