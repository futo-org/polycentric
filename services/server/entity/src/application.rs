//! Model for the `application` table.

use sea_orm::entity::prelude::*;

/// Applications that have authored events, one row per distinct
/// (name, identifier, version, url). Referenced by `events.application_id`.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "application")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i32,
    /// Display name, e.g. "Harbor".
    #[sea_orm(unique_key = "application")]
    pub name: String,
    /// Reverse-DNS package or bundle identifier.
    #[sea_orm(unique_key = "application")]
    pub identifier: String,
    #[sea_orm(unique_key = "application")]
    pub version: String,
    #[sea_orm(unique_key = "application")]
    pub url: String,
}

impl ActiveModelBehavior for ActiveModel {}
