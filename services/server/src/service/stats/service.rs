use std::collections::HashMap;

use polycentric_common::models::protos_v2::{
    EventMetadata, ReactionTally as ProtoReactionTally,
};
use sea_orm::{DbConn, DbErr};

use crate::data::EventId;
use crate::service::stats::repository::{
    Query, ReactionSummary, ReactionTally,
};

#[derive(Default)]
pub struct EventStats {
    reply_counts: HashMap<EventId, i64>,
    reaction_summaries: HashMap<EventId, ReactionSummary>,
    reaction_tallies: HashMap<EventId, Vec<ReactionTally>>,
}

/// Gather reply counts, reaction summaries, and emoji tallies for events.
pub async fn gather_stats_for(
    db: &DbConn,
    event_ids: impl ExactSizeIterator<Item = EventId> + Clone,
) -> Result<EventStats, DbErr> {
    let (reply_counts, reaction_summaries, reaction_tallies) = tokio::try_join!(
        Query::count_replies(db, event_ids.clone()),
        Query::summarize_reactions(db, event_ids.clone()),
        Query::tally_reactions(db, event_ids),
    )?;

    Ok(EventStats {
        reply_counts,
        reaction_summaries,
        reaction_tallies,
    })
}

/// Populate `meta` with values from `stats`.
pub fn include_stats(
    meta: &mut Option<EventMetadata>,
    event_id: EventId,
    stats: &EventStats,
) {
    if let Some(reply_count) = stats.reply_counts.get(&event_id) {
        meta.get_or_insert_default().reply_count =
            Some(truncate_count(*reply_count));
    }

    if let Some(summary) = stats.reaction_summaries.get(&event_id) {
        let meta = meta.get_or_insert_default();
        meta.reaction_count = Some(truncate_count(
            summary.upvote_count + summary.downvote_count,
        ));
        meta.upvote_count = Some(truncate_count(summary.upvote_count));
        meta.downvote_count = Some(truncate_count(summary.downvote_count));
    }

    if let Some(tallies) = stats.reaction_tallies.get(&event_id) {
        meta.get_or_insert_default().emoji_reactions = tallies
            .iter()
            .map(|tally| ProtoReactionTally {
                emoji: tally.emoji.clone(),
                positive: tally.positive,
                count: truncate_count(tally.count),
            })
            .collect();
    }
}

/// Truncate a stat count to the `i32` max.
/// Assumes counts are non-negative.
fn truncate_count(count: i64) -> i32 {
    i32::try_from(count).unwrap_or(i32::MAX)
}
