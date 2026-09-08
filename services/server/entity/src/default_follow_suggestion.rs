//! Model for the `default_follow_suggestion` table.

use sea_orm::entity::prelude::*;

/// Table containing the identities that are suggested by default.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "default_follow_suggestion")]
pub struct Model {
    /// Identity to suggested.
    #[sea_orm(primary_key, auto_increment = false)]
    pub identity: String,
    /// When the suggestion was added.
    pub created_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
