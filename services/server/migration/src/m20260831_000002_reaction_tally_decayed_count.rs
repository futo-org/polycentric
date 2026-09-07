use crate::sea_orm::prelude::ChronoUtc;
use entity::{event_model, gravity_model, reaction_tally_model};
use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::ColumnTrait;

#[derive(DeriveMigrationName)]
pub struct Migration;

const INDEX: &str = "reaction_tally_decayed_count";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();

        // Add a decayed_count column to the reaction_tally table.
        // This will be used for things like the explore feed so we don't have
        // to compute the decayed count for each request.
        let mut stmt = Table::alter();
        stmt.table(reaction_tally_model::Entity).add_column(
            ColumnDef::new(reaction_tally_model::Column::DecayedCount)
                .decimal_len(20, 11)
                .not_null()
                .default(0.0), // NOTE: deleted below.
        );
        tx.execute(&stmt).await?;

        // Add a calculated_at column to the gravity table.
        // This will be set by the calculation doing every ~5 minutes
        // (configurable). It's then used by put_events to update the decayed
        // score when adding or removing reactions.
        let mut stmt = Table::alter();
        stmt.table(gravity_model::Entity).add_column(
            ColumnDef::new(gravity_model::Column::CalculatedAt)
                .timestamp_with_time_zone()
                .null(), // Changed below.
        );
        tx.execute(&stmt).await?;
        // Set the value to the current time.
        let mut query = UpdateStatement::new();
        query.table(gravity_model::Entity).values([(
            gravity_model::Column::CalculatedAt,
            Expr::from(ChronoUtc::now()),
        )]);
        tx.execute(&query).await?;
        // Make it not null.
        let mut stmt = Table::alter();
        stmt.table(gravity_model::Entity).modify_column(
            ColumnDef::new(gravity_model::Column::CalculatedAt)
                .timestamp_with_time_zone()
                .not_null(),
        );
        tx.execute(&stmt).await?;

        // Make two changes to the decay function:
        //  * Use the `calculated_at` value from the `gravity` (by default)
        //    instead of the current time.
        //  * Adds 1 to the count to ensure that new posts don't have a score of
        //    0 and thus never make it to the explore feed.
        tx.execute_unprepared(
            "DROP FUNCTION IF EXISTS reaction_count_decay(BIGINT, TIMESTAMPTZ)",
        )
        .await
        .unwrap();
        tx.execute_unprepared("DROP FUNCTION IF EXISTS reaction_count_decay(BIGINT, TIMESTAMPTZ, NUMERIC)").await.unwrap();
        tx.execute_unprepared("DROP FUNCTION IF EXISTS reaction_count_decay(BIGINT, TIMESTAMPTZ, NUMERIC, TIMESTAMPTZ)").await.unwrap();

        let create_function =
            "CREATE OR REPLACE FUNCTION reaction_count_decay(reaction_count BIGINT, post_created_at TIMESTAMPTZ, gravity NUMERIC, gravity_time TIMESTAMPTZ) RETURNS NUMERIC
              LANGUAGE sql IMMUTABLE PARALLEL SAFE
            RETURN (
              (reaction_count + 1)::NUMERIC / power(
                -- The number of seconds since submission.
                (EXTRACT(epoch FROM (gravity_time - post_created_at))::NUMERIC
                  / 3600::NUMERIC) -- Turned into number of hours.
                  + 2::NUMERIC,
                gravity
              )
            )::NUMERIC(20, 11);";
        tx.execute_unprepared(&create_function).await.unwrap();
        // Version without gravity_time argument.
        let create_function =
            "CREATE OR REPLACE FUNCTION reaction_count_decay(reaction_count BIGINT, post_created_at TIMESTAMPTZ, gravity NUMERIC) RETURNS NUMERIC
              LANGUAGE sql STABLE PARALLEL SAFE
            RETURN reaction_count_decay(reaction_count, post_created_at, gravity, (SELECT calculated_at FROM gravity));";
        tx.execute_unprepared(&create_function).await.unwrap();
        // Version with only the reaction count and post creation time.
        let create_function = "CREATE OR REPLACE FUNCTION reaction_count_decay(reaction_count BIGINT, post_created_at TIMESTAMPTZ) RETURNS NUMERIC
              LANGUAGE sql STABLE PARALLEL SAFE
            RETURN reaction_count_decay(reaction_count, post_created_at, (SELECT value FROM gravity), (SELECT calculated_at FROM gravity));";
        tx.execute_unprepared(&create_function).await.unwrap();

        // Update all decayed counts.
        let mut query = UpdateStatement::new();
        query
            .table(reaction_tally_model::Entity)
            .value(
                reaction_tally_model::Column::DecayedCount,
                Func::cust("reaction_count_decay").args([
                    Expr::col(
                        reaction_tally_model::Column::PositiveCount
                            .as_column_ref(),
                    ),
                    Expr::col(event_model::Column::CreatedAt.as_column_ref()),
                ]),
            )
            .from(event_model::Entity)
            .and_where(Expr::col(event_model::Column::Id.as_column_ref()).eq(
                Expr::col(
                    reaction_tally_model::Column::EventId.as_column_ref(),
                ),
            ));
        tx.execute(&query).await?;

        // Delete the default value for the decayed count, it should always be
        // set. This is important because post with a decayed count of zero are
        // NOT considered when updating the counts in the cron job (as counts
        // only go down over time).
        //
        // NOTE: `TableAlterStatement::modify_column` doesn't work for this.
        tx.execute_unprepared(&format!(
            "ALTER TABLE {} ALTER COLUMN {} DROP DEFAULT",
            reaction_tally_model::Entity.quoted(),
            reaction_tally_model::Column::DecayedCount.quoted(),
        ))
        .await?;

        // Index that filters out decay counts of zero. This allows us to speed
        // up the query significantly.
        tx.execute_unprepared(&format!(
            "CREATE INDEX {INDEX} ON {0} ({1}) WHERE {1} > 0",
            reaction_tally_model::Entity.quoted(),
            reaction_tally_model::Column::DecayedCount.quoted(),
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tx = manager.get_connection();

        // Reset all versions of the decay function back to the old version.
        tx.execute_unprepared(
            "DROP FUNCTION IF EXISTS reaction_count_decay(BIGINT, TIMESTAMPTZ)",
        )
        .await
        .unwrap();
        tx.execute_unprepared("DROP FUNCTION IF EXISTS reaction_count_decay(BIGINT, TIMESTAMPTZ, NUMERIC)").await.unwrap();
        tx.execute_unprepared("DROP FUNCTION IF EXISTS reaction_count_decay(BIGINT, TIMESTAMPTZ, NUMERIC, TIMESTAMPTZ)").await.unwrap();
        let create_function =
            "CREATE OR REPLACE FUNCTION reaction_count_decay(count BIGINT, created_at TIMESTAMPTZ, gravity NUMERIC) RETURNS NUMERIC
              LANGUAGE sql IMMUTABLE PARALLEL SAFE
            RETURN (
              count::NUMERIC / power(
                -- The number of seconds since submission.
                (EXTRACT(epoch FROM (CURRENT_TIMESTAMP - created_at))::NUMERIC
                  / 3600::NUMERIC) -- Turned into number of hours.
                  + 2::NUMERIC,
                gravity
              )
            )::NUMERIC(20, 11);";
        tx.execute_unprepared(&create_function).await.unwrap();

        let create_function = "CREATE OR REPLACE FUNCTION reaction_count_decay(count BIGINT, created_at TIMESTAMPTZ) RETURNS NUMERIC
              LANGUAGE sql STABLE PARALLEL SAFE
            RETURN reaction_count_decay(count, created_at, (SELECT value FROM gravity));";
        tx.execute_unprepared(&create_function).await.unwrap();

        //  Drop the added decayed count column.
        let mut stmt = Table::alter();
        stmt.table(reaction_tally_model::Entity)
            .drop_column(reaction_tally_model::Column::DecayedCount);
        tx.execute(&stmt).await?;

        // And drop the calculated at column.
        let mut stmt = Table::alter();
        stmt.table(gravity_model::Entity)
            .drop_column(gravity_model::Column::CalculatedAt);
        tx.execute(&stmt).await?;

        // Finally drop the index.
        let mut index = Index::drop();
        index
            .if_exists()
            .name(INDEX)
            .table(reaction_tally_model::Entity);
        tx.execute(&index).await?;

        Ok(())
    }
}
