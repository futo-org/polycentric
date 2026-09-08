use sea_orm::entity::prelude::*;

/// Identities banned on this server. Presence of a row means the
/// identity is banned.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ban")]
pub struct Model {
    // sha256 hash of the initial Identity content; matches
    // `content_identity.identity`. Not FK'd because identity is derived
    // from the identity event stream.
    #[sea_orm(primary_key, auto_increment = false)]
    pub identity: String,

    // Identity of the moderator who issued the ban (their
    // `moderator_identity`). Null for bans predating this column or
    // created out-of-band, where the banner is unknown.
    pub banned_by: Option<String>,

    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
