use sea_orm::entity::prelude::*;

/// One row per out-of-network reaction (`AttributedToReaction`) — a reaction to
/// a URL, e.g. a video like/dislike. Keyed by `content_id` (one reaction per
/// event); the attributed URL is indexed so reaction counts can be aggregated
/// per URL. Mirrors `content_reaction`, but the target is a URL instead of an
/// in-network event key.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content_attributed_to_reaction")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub content_id: i64,
    #[sea_orm(belongs_to, from = "content_id", to = "id")]
    pub parent: HasOne<super::content::Entity>,

    // The attributed URL (Link.url) being reacted to, stored verbatim.
    // Indexed for per-URL reaction-count aggregation.
    #[sea_orm(indexed)]
    pub url: String,

    // Optional emoji
    pub emoji: Option<String>,
    // Upvote = true. Downvote = false. Mirrors `AttributedToReaction.positive`
    // in the v2 content proto.
    pub positive: bool,
}

impl ActiveModelBehavior for ActiveModel {}
