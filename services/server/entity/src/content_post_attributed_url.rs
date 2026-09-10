use sea_orm::entity::prelude::*;

/// One row per URL a post is attributed to (`Post.attributed_to[].link.url`).
/// Storing them one-per-row (a post may attribute to several URLs) lets
/// `GetAttributionFeed` look posts up by URL. Mirrors the `content_label`
/// shape: composite PK on (content_id, url), owned by the content row.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_post_attributed_url")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // The attributed URL (Link.url), stored verbatim. Indexed because the
    // feed lookup is by URL; the composite PK leads with content_id so it
    // does not serve url-only queries.
    #[sea_orm(primary_key, auto_increment = false, indexed)]
    pub url: String,
}

impl ActiveModelBehavior for ActiveModel {}
