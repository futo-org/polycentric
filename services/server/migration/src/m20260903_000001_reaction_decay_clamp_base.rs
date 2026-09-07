use sea_orm_migration::prelude::*;

// Clamp the decay base so `power()` never sees a negative number. A post newer
// than the gravity table's `calculated_at` (e.g. when the gravity cron is stale,
// or a migrated post is inserted) would otherwise make `(gravity_time - created_at)`
// negative, and `power(negative, fractional_gravity)` errors. Treat such a post
// as age 0 (highest score) instead.
#[derive(DeriveMigrationName)]
pub struct Migration;

const CLAMPED: &str = "CREATE OR REPLACE FUNCTION reaction_count_decay(reaction_count BIGINT, post_created_at TIMESTAMPTZ, gravity NUMERIC, gravity_time TIMESTAMPTZ) RETURNS NUMERIC
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN (
      (reaction_count + 1)::NUMERIC / power(
        GREATEST(
          EXTRACT(epoch FROM (gravity_time - post_created_at))::NUMERIC / 3600::NUMERIC,
          0::NUMERIC
        ) + 2::NUMERIC,
        gravity
      )
    )::NUMERIC(20, 11);";

const UNCLAMPED: &str = "CREATE OR REPLACE FUNCTION reaction_count_decay(reaction_count BIGINT, post_created_at TIMESTAMPTZ, gravity NUMERIC, gravity_time TIMESTAMPTZ) RETURNS NUMERIC
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN (
      (reaction_count + 1)::NUMERIC / power(
        (EXTRACT(epoch FROM (gravity_time - post_created_at))::NUMERIC / 3600::NUMERIC) + 2::NUMERIC,
        gravity
      )
    )::NUMERIC(20, 11);";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(CLAMPED).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(UNCLAMPED)
            .await?;
        Ok(())
    }
}
