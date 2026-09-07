//! Cron system.

use std::future::Future;
use std::ops::ControlFlow;
use std::time::Duration;

use sea_orm::sea_query::{Expr, PgFunc, SelectStatement};
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbErr,
    TransactionTrait,
};
use tokio::time::{MissedTickBehavior, interval};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

mod gravity;

/// Start all cron jobs.
pub(crate) fn start_jobs(db: DatabaseConnection) -> Cron {
    let cron = Cron {
        tasks: TaskTracker::new(),
        cancel: CancellationToken::new(),
    };

    gravity::update(&cron, db.clone());

    cron
}

/// Cron jobs.
pub(crate) struct Cron {
    tasks: TaskTracker,
    cancel: CancellationToken,
}

impl Cron {
    /// Cancel all jobs and wait for all jobs to stop.
    pub(crate) async fn wait(self) {
        self.tasks.close();
        self.cancel.cancel();
        self.tasks.wait().await;
    }

    /// Run `f` every `period` until it's canceled.
    fn every<F, Fut>(&self, period: Duration, mut f: F)
    where
        F: FnMut() -> Fut + Send + 'static,
        Fut: Future<Output = ControlFlow<()>> + Send + 'static,
    {
        let mut interval = interval(period);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let cancel = self.cancel.clone();
        self.tasks
            .spawn(cancel.run_until_cancelled_owned(async move {
                loop {
                    interval.tick().await;
                    if let ControlFlow::Break(()) = f().await {
                        break;
                    }
                }
            }));
    }
}

/// Postgres lock.
#[repr(u8)]
#[derive(Copy, Clone, Debug)]
enum AdvisoryLock {
    Gravity = 0,
    DecayedReactionCounts = 1,
}

impl AdvisoryLock {
    /// Lock the key and run `f`.
    ///
    /// In production/staging we run multiple instances of the server
    /// simultaneously, this means the varios cron jobs are run concurrently.
    /// For some jobs that's fine, but for others it's a problem or even just
    /// wasteful.
    ///
    /// To prevent concurrent jobs doing the same things we use Postgres
    /// advisory locks. We lock a key, and as long as all keys are created using
    /// the same method, we can ensure that only a single job of the same kind
    /// runs concurrently.
    ///
    /// However if other code, not this cron system, starts using advisory locks
    /// we might have an issue with two unrelated components using the same
    /// locks.
    ///
    /// We could use row level locking as well, but then we lock all out all
    /// other users of the rows, which is not ideal for rows that are accessed a
    /// lot (especially if it's not needed).
    async fn try_lock(
        self,
        db: &DatabaseConnection,
    ) -> Result<Option<DatabaseTransaction>, DbErr> {
        let tx = db.begin().await?;

        let lock_key = self as i64;
        let mut query = SelectStatement::new();
        query.expr(PgFunc::try_advisory_lock(Expr::Constant(lock_key.into())));
        if db
            .query_one(&query)
            .await?
            .map_or(Ok(false), |r| r.try_get_by(0))?
        {
            Ok(Some(tx))
        } else {
            // Another instance already holds the lock.
            tx.rollback().await?;
            Ok(None)
        }
    }
}
