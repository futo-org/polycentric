//! Model for the `gravity` table.

use sea_orm::entity::prelude::*;

/// Gravity value used by the `reaction_count_decay` SQL function.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gravity")]
pub struct Model {
    /// Value of the gravity.
    ///
    /// NOTE: actual type `NUMERIC(20, 11)`.
    // NOTE: the table doesn't have a primary key, but SeaORM need one.
    #[sea_orm(primary_key, auto_increment = false)]
    pub value: String,
    /// Time at which the decayed counts were last calculated.
    pub calculated_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
