//! Cron job that updates gravity value.

use std::ops::ControlFlow;

use entity::{
    event_model, gravity_model, reaction_model, reaction_tally_model,
};
use sea_orm::sea_query::{
    Asterisk, Expr, Func, SelectStatement, UpdateStatement,
};
use sea_orm::{ColumnTrait, ConnectionTrait, DatabaseConnection, ExprTrait};

use crate::config;
use crate::cron::{AdvisoryLock, Cron};

pub(crate) fn update(cron: &Cron, db: DatabaseConnection) {
    let config = config::get();

    let feeds_gravity = config.feeds_gravity;
    let gravity_per_reaction = config.dynamic_feeds_gravity_per_reaction;
    let hours = config.dynamic_feeds_gravity_hours;
    let every = config.feed_count_update_frequency;
    cron.every(every, move || {
        tracing::debug!(gravity_per_reaction, hours, "updating gravity");
        let db = db.clone();
        async move {
            let start = std::time::Instant::now();

            // First we need to update the gravity calculate timestamp, and if
            // we're using dynamic gravity calculate the gravity value.
            //
            // NOTE: we do this is in a separate transaction because the
            // gravity table is used by `reaction_count_decay` and when we
            // update it, while also updating all the decayed counts it
            // means we lock out creation of reaction events. This caused
            // #292.
            //
            // This does mean that between the time this transaction commits
            // and the recalculation transaction below commits the decayed
            // counts are technically incorrect. Furthermore if the
            // recalculation job, for whatever reason, doesn't finish the counts
            // will remain incorrect.
            //
            // Luckily this job should run pretty often so it's a time
            // window of a couple of minutes were this could be the case.

            let tx = match AdvisoryLock::Gravity.try_lock(&db).await {
                Ok(Some(tx)) => tx,
                // Another instance is doing the work.
                Ok(None) => return ControlFlow::Continue(()),
                Err(err) => {
                    tracing::warn!(error = %err, "failed acquire gravity lock");
                    return ControlFlow::Continue(());
                }
            };

            let mut gravity_value = SelectStatement::new();
            if let Some(gravity) = feeds_gravity {
                gravity_value.expr_as(Expr::Constant(gravity.into()), "gravity");
            } else {
                // Calculate the dynamic gravity value.
                gravity_value
                    .expr_as(
                        // Make sure we don't divide by zero.
                        Func::greatest([
                            Expr::from(Func::count(Expr::col(Asterisk))),
                            Expr::Constant(1.into()),
                        ])
                        .cast_as("NUMERIC(20,11)")
                        .mul(Expr::Constant(gravity_per_reaction.into())),
                        "gravity",
                    )
                    .from(reaction_model::Entity)
                    .inner_join(
                        event_model::Entity,
                        Expr::col(event_model::Column::Id.as_column_ref())
                            .equals(
                                reaction_model::Column::EventId
                                    .as_column_ref(),
                            ),
                    )
                    .cond_where(ExprTrait::eq(
                        Expr::col(
                            reaction_model::Column::Positive
                                .as_column_ref(),
                        ),
                        Expr::Constant(true.into()),
                    ))
                    .cond_where(ExprTrait::gte(
                        Expr::col(
                            event_model::Column::CreatedAt.as_column_ref(),
                        ),
                        Expr::current_timestamp().sub(Expr::cust(format!(
                            "INTERVAL '{hours} hours'"
                        ))),
                    ));
            }

            // Update the gravity value and calculation timestamp.
            let mut update_gravity = UpdateStatement::new();
            update_gravity.table(gravity_model::Entity)
                .value(
                    gravity_model::Column::Value,
                    Expr::from(gravity_value),
                )
                .value(
                    gravity_model::Column::CalculatedAt,
                    Expr::current_timestamp(),
                );

            if let Err(err) = tx.execute(&update_gravity).await {
                tracing::warn!(error = %err, "failed to update gravity value & timestamp");
            }
            if let Err(err) = tx.commit().await {
                tracing::warn!(error = %err, "failed to commit gravity value & timestamp changes");
            }
            tracing::debug!(elapsed = ?start.elapsed(), "updated gravity value");

            let tx = match AdvisoryLock::DecayedReactionCounts.try_lock(&db).await {
                Ok(Some(tx)) => tx,
                // Another instance is doing the work. So it seems we took a
                // while to get here after we updated the gravity...
                Ok(None) => return ControlFlow::Continue(()),
                Err(err) => {
                    tracing::warn!(error = %err, "failed acquire decayed reactio counts lock");
                    return ControlFlow::Continue(());
                }
            };

            // Update all calculated decayed counts.
            let mut query = UpdateStatement::new();
            query
                .table(reaction_tally_model::Entity)
                .from(gravity_model::Entity)
                .value(
                    reaction_tally_model::Column::DecayedCount,
                    {
                        let func = Func::cust("reaction_count_decay");
                        if let Some(feeds_gravity) = feeds_gravity {
                            func.args([
                                Expr::col(reaction_tally_model::Column::PositiveCount.as_column_ref()),
                                Expr::col(event_model::Column::CreatedAt.as_column_ref()),
                                Expr::Constant(feeds_gravity.into()),
                            ])
                        } else {
                            func.args([
                                Expr::col(reaction_tally_model::Column::PositiveCount.as_column_ref()),
                                Expr::col(event_model::Column::CreatedAt.as_column_ref()),
                            ])
                        }
                    },
                )
                // This should be an inner join, but SeaORM doesn't support this,
                // see <https://github.com/SeaQL/sea-query/issues/608>.
                .from(event_model::Entity)
                .and_where(
                    Expr::col(event_model::Column::Id.as_column_ref())
                        .eq(Expr::col(reaction_tally_model::Column::EventId.as_column_ref())),
                )
                // If the decayed count was previously already zero there is no
                // point in calculating it again as it can only go lower.
                .and_where(Expr::col(reaction_tally_model::Column::DecayedCount.as_column_ref()).gt(Expr::Constant(0.0.into())));

            if let Err(err) = tx.execute(&query).await {
                tracing::warn!(error = %err, "failed to update decayed reaction counts");
            }
            if let Err(err) = tx.commit().await {
                tracing::warn!(error = %err, "failed to commit decayed reaction counts changes");
            }
            tracing::debug!(elapsed = ?start.elapsed(), "updated all decayed counts");

            ControlFlow::Continue(())
        }
    });
}
