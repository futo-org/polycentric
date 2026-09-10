use sea_orm::entity::prelude::*;

/// Cached outcome of resolving a mention alias through its domain's
/// `/.well-known/polycentric.json`. `alias` is the lowercased alias as
/// mentioned (`user@domain.com` or a bare `domain.com`). A null `identity`
/// means the last lookup failed or the document had no entry. Freshness is
/// judged against `updated_at`; a stale row just triggers a refetch.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "alias_cache")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub alias: String,
    pub identity: Option<String>,
    pub updated_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
