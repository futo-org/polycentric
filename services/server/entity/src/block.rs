use sea_orm::entity::prelude::*;

/// This table contains a row for each block, based on block events (and associated
/// deletion events) in the `events` table. The table is used as a cache for
/// feed request pipelines.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "block")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub event_id: i64,
    pub blocker: String,
    pub blocked: String,

    #[sea_orm(belongs_to, from = "event_id", to = "id")]
    pub parent: HasOne<super::event::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
