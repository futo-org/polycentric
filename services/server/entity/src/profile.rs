//! Model for the `profile` table.

use sea_orm::entity::prelude::*;

/// Cache for profile update.
///
/// This table contains a row for the latest, *not-deleted* profile update for
/// each identity, based on the (valid) profile update and deletion events in
/// `events` table.
///
/// This table purely serves as a cache. The source of truth is always the
/// `events` table and this table can be fully recreated based on it.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "profile")]
pub struct Model {
    /// Primary key.
    ///
    /// Also a foreign key to the event (`events` table).
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_id: i64,
    /// Identity key (sha256 hash of the initial Identity content).
    ///
    /// Same as `events.identity`.
    pub identity: String,

    #[sea_orm(belongs_to, from = "event_id", to = "id")]
    pub parent: HasOne<super::event::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
