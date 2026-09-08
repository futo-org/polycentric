//! Model for the `quote` table.

use sea_orm::entity::prelude::*;

/// Cache for quotes.
///
/// This table contains a row for each *not-deleted* post that quotes another
/// post, based on the (valid) post and deletion events in `events` table.
///
/// This table purely serves as a cache. The source of truth is always the
/// `events` table and this table can be fully recreated based on it.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "quote")]
pub struct Model {
    /// Id of the event that contains the quote.
    ///
    /// Also a foreign key to the event (`events` table).
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_id: i64,
    /// Identity key (sha256 hash of the initial Identity content).
    ///
    /// Same as `events.identity`.
    pub identity: String,
    /// Id of the event that contains the post that is being quoted.
    ///
    /// Also a foreign key to the event (`events` table).
    pub post: i64,

    #[sea_orm(belongs_to, from = "event_id", to = "id")]
    pub parent: HasOne<super::event::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
