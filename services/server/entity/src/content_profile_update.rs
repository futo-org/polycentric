use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_profile_update")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // Display name
    pub name: Option<String>,

    pub avatar: Option<Json>,
    pub banner: Option<Json>,
    pub description: Option<String>,
    pub alias: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}
