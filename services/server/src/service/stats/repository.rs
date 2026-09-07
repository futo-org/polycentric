use std::collections::HashMap;

use entity::{
    attributed_to_reaction_summary_model as AttributedSummaryModel,
    reaction_model, reaction_tally_model, reply_model,
};
use sea_orm::ActiveValue::Set;
use sea_orm::sea_query::{
    Asterisk, ColumnRef, Expr, ExprTrait, Func, OnConflict, Order,
    SelectStatement,
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbConn, DbErr, EntityTrait, QueryFilter,
};

use crate::data::EventId;

pub struct Query;

impl Query {
    /// For each event in `events`, estimate the number of replies it has.
    /// Results are returned as a map from each event's key to its reply count.
    /// Events without any replies may be excluded from the output map.
    pub async fn count_replies(
        db: &DbConn,
        event_ids: impl ExactSizeIterator<Item = EventId>,
    ) -> Result<HashMap<EventId, i64>, DbErr> {
        if event_ids.len() == 0 {
            return Ok(HashMap::new());
        }

        let mut query = SelectStatement::new();
        query
            .from(reply_model::Entity)
            .expr_as(
                Expr::col(reply_model::Column::Post.as_column_ref()),
                "post",
            )
            .expr_as(Expr::from(Func::count(Expr::col(Asterisk))), "count")
            .cond_where(
                Expr::col(reply_model::Column::Post.as_column_ref())
                    .is_in(event_ids),
            )
            .group_by_col(reply_model::Column::Post.as_column_ref());

        let rows = db.query_all(&query).await?;
        let map = rows
            .into_iter()
            .map(|row| -> Result<(EventId, i64), DbErr> {
                Ok((row.try_get_by(0)?, row.try_get_by(1)?))
            })
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(map)
    }

    /// For each event in `events`, get our estimates for the reaction summary counts.
    /// Results are returned as a map from each event's key to its reaction summary.
    /// Events with no reactions may be excluded from the output map.
    pub async fn summarize_reactions(
        db: &DbConn,
        event_ids: impl ExactSizeIterator<Item = EventId>,
    ) -> Result<HashMap<EventId, ReactionSummary>, DbErr> {
        if event_ids.len() == 0 {
            return Ok(HashMap::new());
        }

        let mut query = SelectStatement::new();
        query
            .from(reaction_tally_model::Entity)
            .expr_as(
                Expr::col(
                    reaction_tally_model::Column::EventId.as_column_ref(),
                ),
                "event_id",
            )
            .expr_as(
                Expr::col(
                    reaction_tally_model::Column::PositiveCount.as_column_ref(),
                ),
                "positive_count",
            )
            .expr_as(
                Expr::col(
                    reaction_tally_model::Column::NegativeCount.as_column_ref(),
                ),
                "negative_count",
            )
            .cond_where(
                Expr::col(
                    reaction_tally_model::Column::EventId.as_column_ref(),
                )
                .is_in(event_ids),
            );

        let rows = db.query_all(&query).await?;
        let map = rows
            .into_iter()
            .map(|row| -> Result<(EventId, ReactionSummary), DbErr> {
                let event_id = row.try_get_by(0)?;
                let positive_count = row.try_get_by(1)?;
                let negative_count = row.try_get_by(2)?;
                Ok((
                    event_id,
                    ReactionSummary {
                        upvote_count: positive_count,
                        downvote_count: negative_count,
                    },
                ))
            })
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(map)
    }

    /// Get our estimate for the count of each `(emoji, positive)` reaction to
    /// the events specified by `event_keys`.
    /// Up to `limit` rows will be returned for each event key ordered by most
    /// popular to least.
    pub async fn tally_reactions(
        db: &DbConn,
        event_ids: impl ExactSizeIterator<Item = EventId>,
    ) -> Result<HashMap<EventId, Vec<ReactionTally>>, DbErr> {
        if event_ids.len() == 0 {
            return Ok(HashMap::new());
        }

        let mut query = SelectStatement::new();
        query
            .from(reaction_model::Entity)
            .expr_as(
                Expr::col(reaction_model::Column::OnPost.as_column_ref()),
                "on_post",
            )
            .expr_as(
                Expr::col(reaction_model::Column::Emoji.as_column_ref()),
                "emoji",
            )
            .expr_as(
                Expr::col(reaction_model::Column::Positive.as_column_ref()),
                "positive",
            )
            .expr_as(Expr::from(Func::count(Expr::col(Asterisk))), "count")
            .cond_where(
                Expr::col(reaction_model::Column::OnPost.as_column_ref())
                    .is_in(event_ids),
            )
            .and_where(
                Expr::col(reaction_model::Column::Emoji.as_column_ref())
                    .is_not_null(),
            )
            .group_by_columns([
                reaction_model::Column::OnPost.as_column_ref(),
                reaction_model::Column::Emoji.as_column_ref(),
                reaction_model::Column::Positive.as_column_ref(),
            ])
            .order_by_columns([
                (
                    ColumnRef::from(
                        reaction_model::Column::OnPost.as_column_ref(),
                    ),
                    Order::Desc,
                ),
                (ColumnRef::from("count"), Order::Desc),
                (
                    ColumnRef::from(
                        reaction_model::Column::Emoji.as_column_ref(),
                    ),
                    Order::Desc,
                ),
                (
                    ColumnRef::from(
                        reaction_model::Column::Positive.as_column_ref(),
                    ),
                    Order::Desc,
                ),
            ]);

        let rows = db.query_all(&query).await?;
        let mut map = HashMap::new();
        for row in rows {
            let on_post = row.try_get_by(0)?;
            let tally = ReactionTally {
                emoji: row.try_get_by(1)?,
                positive: row.try_get_by(2)?,
                count: row.try_get_by(3)?,
            };
            let reactions: &mut Vec<ReactionTally> =
                map.entry(on_post).or_default();
            let idx = reactions.binary_search_by(|r| {
                (tally.count, &*tally.emoji, tally.positive)
                    .cmp(&(r.count, &*r.emoji, r.positive))
            });
            match idx {
                Ok(idx) | Err(idx) => reactions.insert(idx, tally),
            }
        }
        Ok(map)
    }
}

pub struct Mutation;

impl Mutation {
    /// Increment the upvote/downvote count for an out-of-network (URL)
    /// reaction, creating the summary row with a count of 1 if none exists yet.
    /// Mirrors `count_reaction_for` but keyed by URL.
    pub async fn count_attributed_reaction_for(
        db: &DbConn,
        url: String,
        positive: bool,
    ) -> Result<(), DbErr> {
        let (upvote, downvote) = if positive { (1, 0) } else { (0, 1) };

        let count_col = if positive {
            AttributedSummaryModel::Column::UpvoteCount
        } else {
            AttributedSummaryModel::Column::DownvoteCount
        };

        AttributedSummaryModel::Entity::insert(
            AttributedSummaryModel::ActiveModel {
                url: Set(url),
                upvote_count: Set(upvote),
                downvote_count: Set(downvote),
            },
        )
        .on_conflict(
            OnConflict::column(AttributedSummaryModel::Column::Url)
                .value(
                    count_col,
                    Expr::col((AttributedSummaryModel::Entity, count_col))
                        .add(1),
                )
                .to_owned(),
        )
        .exec(db)
        .await?;

        Ok(())
    }

    /// Decrement the upvote/downvote count for an out-of-network (URL)
    /// reaction, only when that count is greater than zero.
    pub async fn remove_attributed_reaction_for(
        db: &DbConn,
        url: String,
        positive: bool,
    ) -> Result<(), DbErr> {
        let count_col = if positive {
            AttributedSummaryModel::Column::UpvoteCount
        } else {
            AttributedSummaryModel::Column::DownvoteCount
        };

        AttributedSummaryModel::Entity::update_many()
            .col_expr(count_col, Expr::col(count_col).sub(1))
            .filter(
                AttributedSummaryModel::Column::Url
                    .eq(url)
                    .and(count_col.gt(0)),
            )
            .exec(db)
            .await?;

        Ok(())
    }

    /// Read the maintained `(upvote, downvote)` counts for a URL; `(0, 0)` if
    /// no reactions have been recorded for it yet.
    pub async fn get_attributed_reaction_summary(
        db: &DbConn,
        url: &str,
    ) -> Result<(i64, i64), DbErr> {
        let row = AttributedSummaryModel::Entity::find_by_id(url.to_owned())
            .one(db)
            .await?;
        Ok(row
            .map(|r| (r.upvote_count, r.downvote_count))
            .unwrap_or((0, 0)))
    }
}

pub struct ReactionSummary {
    pub upvote_count: i64,
    pub downvote_count: i64,
}

pub struct ReactionTally {
    pub emoji: String,
    pub positive: bool,
    pub count: i64,
}
