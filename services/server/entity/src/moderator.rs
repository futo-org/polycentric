use sea_orm::entity::prelude::*;

/// Identities the server recognizes as moderators. Presence of a row
/// means the identity is a moderator.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "moderator")]
pub struct Model {
    // sha256 hash of the initial Identity content; matches
    // `content_identity.identity`. Not FK'd because identity is derived
    // from the identity event stream.
    #[sea_orm(primary_key, auto_increment = false)]
    pub identity: String,

    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
