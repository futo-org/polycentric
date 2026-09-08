//! Model for the `reaction` table.

use sea_orm::entity::prelude::*;

/// Cache for reactions.
///
/// This table contains a row for each *not-deleted* reaction, based on the
/// (valid) reaction and deletion events in `events` table.
///
/// This table purely serves as a cache. The source of truth is always the
/// `events` table and this table can be fully recreated based on it.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "reaction")]
pub struct Model {
    /// Id of the event that contains the reaction.
    ///
    /// Also a foreign key to the event (`events` table).
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_id: i64,
    /// Identity key (sha256 hash of the initial Identity content).
    ///
    /// Same as `events.identity`.
    pub identity: String,
    /// Id of the event that contains the post this is a reaction to.
    ///
    /// Also a foreign key to the event (`events` table).
    pub on_post: i64,
    pub emoji: Option<String>,
    pub positive: bool,

    #[sea_orm(belongs_to, from = "event_id", to = "id")]
    pub parent: HasOne<super::event::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
