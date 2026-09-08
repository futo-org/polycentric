use sea_orm::entity::prelude::*;

/// Maintained per-URL reaction counts for out-of-network reactions
/// (`AttributedToReaction`) — e.g. video like/dislike totals. Mirrors
/// `reaction_summaries`, but keyed by the attributed URL instead of an event
/// key. Kept up to date incrementally by the stats worker.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "attributed_to_reaction_summaries")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub url: String,
    /// Our estimate for the number of positive reactions the URL has.
    pub upvote_count: i64,
    /// Our estimate for the number of negative reactions the URL has.
    pub downvote_count: i64,
}

impl ActiveModelBehavior for ActiveModel {}
