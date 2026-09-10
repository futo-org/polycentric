use std::cmp::Reverse;
use std::collections::HashMap;

use crate::service::feeds::repository::content_join;
use ::entity::{content, content_profile_update, event, notification};
use polycentric_common::models::collections;
use sea_orm::*;
use sea_query::{Expr, Func};

const PROFILE_COLLECTION: i16 = collections::PROFILE as i16;

pub struct Query;

impl Query {
    /// Notifications addressed to `to_identity`, newest first.
    pub async fn list_for_identity(
        db: &DbConn,
        to_identity: &str,
        limit: u64,
        after_id: Option<i64>,
    ) -> Result<Vec<notification::Model>, DbErr> {
        let mut query = notification::Entity::find()
            .filter(notification::Column::ToIdentity.eq(to_identity))
            .order_by_desc(notification::Column::Id)
            .limit(limit);

        if let Some(after) = after_id {
            query = query.filter(notification::Column::Id.lt(after));
        }

        query.all(db).await
    }

    /// The identity each of `aliases` (lowercased) resolves to, per the
    /// alias each identity's latest profile claims. Aliases nobody claims are
    /// absent. Unverified: a profile may claim any alias; when several claim
    /// the same one, the most recently synced profile wins.
    pub async fn find_identities_by_aliases(
        db: &DbConn,
        aliases: &[String],
    ) -> Result<HashMap<String, String>, DbErr> {
        if aliases.is_empty() {
            return Ok(HashMap::new());
        }
        let lower_alias = || {
            Func::lower(Expr::col((
                content_profile_update::Entity,
                content_profile_update::Column::Alias,
            )))
        };
        // Candidates: identities with any profile claiming one of the
        // aliases (hits the lower(alias) index).
        let mut claimers = event::Entity::find()
            .select_only()
            .column(event::Column::Identity)
            .join(JoinType::InnerJoin, content_join())
            .join(
                JoinType::InnerJoin,
                content::Relation::ContentProfileUpdate.def(),
            )
            .filter(event::Column::Collection.eq(PROFILE_COLLECTION))
            .filter(Expr::from(lower_alias()).is_in(aliases.iter().cloned()));
        // Each candidate's latest profile, whatever alias it claims now.
        let mut latest_profiles = event::Entity::find()
            .select_only()
            .expr_as(lower_alias(), "alias")
            .column(event::Column::Identity)
            .column(event::Column::Id)
            .distinct_on([event::Column::Identity.as_column_ref()])
            .join(JoinType::InnerJoin, content_join())
            .join(
                JoinType::InnerJoin,
                content::Relation::ContentProfileUpdate.def(),
            )
            .filter(event::Column::Collection.eq(PROFILE_COLLECTION))
            .filter(
                Expr::col(event::Column::Identity.as_column_ref())
                    .in_subquery(QuerySelect::query(&mut claimers).to_owned()),
            )
            .order_by_asc(event::Column::Identity)
            .order_by_desc(event::Column::Sequence)
            .into_model::<LatestProfileAlias>()
            .all(db)
            .await?;

        // Only profiles still claiming an alias count; newest wins per alias.
        latest_profiles.sort_by_key(|row| Reverse(row.id));
        let mut identity_by_alias_map = HashMap::new();
        for row in latest_profiles {
            if let Some(alias) = row.alias.filter(|a| aliases.contains(a)) {
                identity_by_alias_map.entry(alias).or_insert(row.identity);
            }
        }
        Ok(identity_by_alias_map)
    }
}

/// One identity's latest profile: the alias it claims (lowercased) and the
/// event id, for picking the most recently synced claim.
#[derive(Debug, FromQueryResult)]
struct LatestProfileAlias {
    alias: Option<String>,
    identity: String,
    id: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase};
    use std::collections::BTreeMap;

    fn alias_row(
        alias: Option<&str>,
        identity: &str,
        id: i64,
    ) -> BTreeMap<String, Value> {
        BTreeMap::from([
            ("alias".to_string(), Value::from(alias)),
            ("identity".to_string(), Value::from(identity)),
            ("id".to_string(), Value::from(id)),
        ])
    }

    #[tokio::test]
    async fn the_newest_claim_of_an_alias_wins() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![
                alias_row(Some("bob@x.com"), "impostor", 1),
                alias_row(Some("bob@x.com"), "bob", 3),
                alias_row(Some("carol@x.com"), "carol", 2),
                // Claimed an alias once, but the latest profile moved on.
                alias_row(Some("dave@y.com"), "dave", 4),
                alias_row(None, "erin", 5),
            ]])
            .into_connection();

        let identity_by_alias_map = Query::find_identities_by_aliases(
            &db,
            &["bob@x.com".to_string(), "carol@x.com".to_string()],
        )
        .await
        .expect("query should succeed");
        assert_eq!(identity_by_alias_map["bob@x.com"], "bob");
        assert_eq!(identity_by_alias_map["carol@x.com"], "carol");
        assert_eq!(identity_by_alias_map.len(), 2);
    }

    #[tokio::test]
    async fn no_aliases_skips_the_query() {
        // No `append_query_results`, so the mock errors if a query runs.
        let db = MockDatabase::new(DatabaseBackend::Postgres).into_connection();
        let identity_by_alias_map = Query::find_identities_by_aliases(&db, &[])
            .await
            .expect("no lookup should be attempted");
        assert!(identity_by_alias_map.is_empty());
    }

    fn sample_row(id: i64, kind: i32) -> notification::Model {
        let ts = chrono::DateTime::from_timestamp(0, 0).unwrap();
        notification::Model {
            id,
            kind,
            from_identity: "alice".to_string(),
            to_identity: "bob".to_string(),
            trigger_event_key_collection: 2,
            trigger_event_key_identity: "alice".to_string(),
            trigger_event_key_public_key_type: 1,
            trigger_event_key_public_key: vec![0xAB],
            trigger_event_key_sequence: 7,
            target_event_key_collection: 0,
            target_event_key_identity: String::new(),
            target_event_key_public_key_type: 0,
            target_event_key_public_key: Vec::new(),
            target_event_key_sequence: 0,
            created_at: ts,
            updated_at: ts,
        }
    }

    #[tokio::test]
    async fn returns_rows_mapped_with_kind() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([vec![sample_row(2, 2), sample_row(1, 1)]])
            .into_connection();

        let rows = Query::list_for_identity(&db, "bob", 50, None)
            .await
            .expect("query should succeed");

        assert_eq!(rows.len(), 2);
        // `kind` in particular must survive the read (it regressed once).
        assert_eq!((rows[0].id, rows[0].kind), (2, 2));
        assert_eq!((rows[1].id, rows[1].kind), (1, 1));
    }

    #[tokio::test]
    async fn without_cursor_filters_orders_and_limits() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<notification::Model>::new()])
            .into_connection();

        Query::list_for_identity(&db, "bob", 25, None)
            .await
            .unwrap();

        let sql = format!("{:?}", db.into_transaction_log());
        assert!(sql.contains("to_identity"), "filters by recipient: {sql}");
        assert!(
            sql.contains("ORDER BY") && sql.contains("DESC"),
            "newest first: {sql}"
        );
        assert!(sql.to_uppercase().contains("LIMIT"), "bounded: {sql}");
        // The cursor predicate (`id < ?`) is the only `<` in the query.
        assert!(
            !sql.contains('<'),
            "no cursor predicate without after: {sql}"
        );
    }

    #[tokio::test]
    async fn with_cursor_adds_id_upper_bound() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<notification::Model>::new()])
            .into_connection();

        Query::list_for_identity(&db, "bob", 25, Some(100))
            .await
            .unwrap();

        let sql = format!("{:?}", db.into_transaction_log());
        assert!(sql.contains('<'), "cursor adds an id upper-bound: {sql}");
    }
}
