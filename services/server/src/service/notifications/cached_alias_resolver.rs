//! A DB-backed cache in front of [`alias_resolver`]: each lookup outcome,
//! resolved or not, is kept in `alias_cache` for [`CACHE_TTL`] so repeated
//! mentions of the same alias don't refetch its domain's document.

use std::collections::HashMap;
use std::future::Future;

use chrono::{TimeDelta, Utc};
use entity::alias_cache;
use sea_orm::sea_query::OnConflict;
use sea_orm::{ColumnTrait, DbConn, EntityTrait, QueryFilter, Set};

use super::alias_resolver;

/// How long a cached outcome (resolved or not) is served before refetching.
const CACHE_TTL: TimeDelta = TimeDelta::minutes(5);

/// The identity each of `aliases` resolves to, keyed by the alias as given.
/// Malformed aliases, failed fetches and aliases the domain doesn't list are
/// absent. Fresh cache rows are served as-is; only the misses are fetched.
/// `aliases` are cached verbatim, so pass them lowercased and deduplicated.
pub async fn resolve_aliases(
    db: &DbConn,
    aliases: &[String],
) -> HashMap<String, String> {
    resolve_aliases_with(db, aliases, |misses| async move {
        alias_resolver::resolve_aliases(&misses).await
    })
    .await
}

/// `resolve_aliases` with the fetch injected, so tests can stub the network.
/// `fetch` returns an outcome for each alias it actually looked up.
async fn resolve_aliases_with<Fut>(
    db: &DbConn,
    aliases: &[String],
    fetch: impl FnOnce(Vec<String>) -> Fut,
) -> HashMap<String, String>
where
    Fut: Future<Output = HashMap<String, Option<String>>>,
{
    let mut outcome_by_alias_map = find_fresh_cached(db, aliases).await;
    let misses: Vec<String> = aliases
        .iter()
        .filter(|alias| !outcome_by_alias_map.contains_key(*alias))
        .cloned()
        .collect();
    if !misses.is_empty() {
        let fetched = fetch(misses).await;
        insert_cached(db, &fetched).await;
        outcome_by_alias_map.extend(fetched);
    }
    outcome_by_alias_map
        .into_iter()
        .filter_map(|(alias, identity)| Some((alias, identity?)))
        .collect()
}

/// Fresh cache rows for `aliases`: alias -> identity (`None` when the last
/// lookup found nothing). Expired rows and DB errors are misses.
async fn find_fresh_cached(
    db: &DbConn,
    aliases: &[String],
) -> HashMap<String, Option<String>> {
    if aliases.is_empty() {
        return HashMap::new();
    }
    alias_cache::Entity::find()
        .filter(alias_cache::Column::Alias.is_in(aliases))
        .filter(alias_cache::Column::UpdatedAt.gt(Utc::now() - CACHE_TTL))
        .all(db)
        .await
        .map_err(|e| tracing::warn!(error = %e, "alias cache lookup failed"))
        .unwrap_or_default()
        .into_iter()
        .map(|row| (row.alias, row.identity))
        .collect()
}

/// Upsert the looked-up outcomes, dropping expired rows on the way so the
/// table stays bounded. Best-effort: failures are logged and resolution
/// proceeds.
async fn insert_cached(db: &DbConn, fetched: &HashMap<String, Option<String>>) {
    if fetched.is_empty() {
        return;
    }
    let now = Utc::now();
    if let Err(e) = alias_cache::Entity::delete_many()
        .filter(alias_cache::Column::UpdatedAt.lte(now - CACHE_TTL))
        .exec(db)
        .await
    {
        tracing::warn!(error = %e, "alias cache expiry failed");
    }
    let rows =
        fetched
            .iter()
            .map(|(alias, identity)| alias_cache::ActiveModel {
                alias: Set(alias.clone()),
                identity: Set(identity.clone()),
                updated_at: Set(now),
            });
    let insert = alias_cache::Entity::insert_many(rows)
        .on_conflict(
            OnConflict::column(alias_cache::Column::Alias)
                .update_columns([
                    alias_cache::Column::Identity,
                    alias_cache::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec_without_returning(db)
        .await;
    if let Err(e) = insert {
        tracing::warn!(error = %e, "alias cache insert failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DbBackend, MockDatabase, MockExecResult};

    #[tokio::test]
    async fn misses_are_fetched_and_every_outcome_is_cached() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![cached_row("bob@x.com", Some("abc"))]])
            .append_exec_results([exec_ok(), exec_ok()])
            .into_connection();

        let identity_by_alias_map = resolve_aliases_with(
            &db,
            &aliases(&["bob@x.com", "x.com", "nobody@x.com"]),
            |misses| async move {
                assert_eq!(misses, aliases(&["x.com", "nobody@x.com"]));
                outcomes(&[("x.com", Some("def")), ("nobody@x.com", None)])
            },
        )
        .await;

        assert_eq!(
            identity_by_alias_map,
            HashMap::from([
                ("bob@x.com".to_string(), "abc".to_string()),
                ("x.com".to_string(), "def".to_string()),
            ])
        );
        let statements: Vec<String> = db
            .into_transaction_log()
            .iter()
            .map(|statement| format!("{statement:?}"))
            .collect();
        assert_eq!(statements.len(), 3, "select, expire, upsert");
        assert!(statements[1].contains("DELETE"), "{}", statements[1]);
        let upsert = &statements[2];
        assert!(upsert.contains("ON CONFLICT"), "{upsert}");
        assert!(upsert.contains("x.com"), "{upsert}");
        assert!(upsert.contains("nobody@x.com"), "{upsert}");
    }

    #[tokio::test]
    async fn fresh_cache_rows_are_served_without_a_fetch_or_write() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![
                cached_row("bob@x.com", Some("abc")),
                cached_row("nobody@x.com", None),
            ]])
            .into_connection();

        let identity_by_alias_map = resolve_aliases_with(
            &db,
            &aliases(&["bob@x.com", "nobody@x.com"]),
            |misses| async move { panic!("fetched {misses:?}") },
        )
        .await;

        assert_eq!(
            identity_by_alias_map,
            HashMap::from([("bob@x.com".to_string(), "abc".to_string())])
        );
        assert_eq!(db.into_transaction_log().len(), 1, "only the SELECT");
    }

    #[tokio::test]
    async fn aliases_the_fetch_skipped_are_not_cached() {
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([Vec::<alias_cache::Model>::new()])
            .into_connection();

        let identity_by_alias_map =
            resolve_aliases_with(&db, &aliases(&["bob@x.com"]), |_| async {
                HashMap::new()
            })
            .await;

        assert!(identity_by_alias_map.is_empty());
        assert_eq!(db.into_transaction_log().len(), 1, "only the SELECT");
    }

    fn aliases(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn outcomes(
        list: &[(&str, Option<&str>)],
    ) -> HashMap<String, Option<String>> {
        list.iter()
            .map(|(alias, identity)| {
                (alias.to_string(), identity.map(str::to_string))
            })
            .collect()
    }

    fn cached_row(alias: &str, identity: Option<&str>) -> alias_cache::Model {
        alias_cache::Model {
            alias: alias.to_string(),
            identity: identity.map(str::to_string),
            updated_at: Utc::now(),
        }
    }

    fn exec_ok() -> MockExecResult {
        MockExecResult {
            last_insert_id: 0,
            rows_affected: 1,
        }
    }
}
