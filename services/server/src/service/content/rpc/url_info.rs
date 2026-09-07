//! `url_info`: fetch link-preview metadata for a URL.
//!
//! The actual fetching, JS prerendering, and Open Graph / HTML extraction are
//! delegated to the internal scraper service (`services/scraper`); this handler
//! calls that service, maps its JSON onto a `UrlInfoResponse`, and caches the
//! outcome in the `url_info_cache` table.

use chrono::{TimeDelta, Utc};
use entity::url_info_cache_model;
use sea_orm::sea_query::{OnConflict, Query as SeaQuery};
use sea_orm::{
    ColumnTrait, DbConn, EntityTrait, Order, PaginatorTrait, QueryFilter, Set,
};
use serde::Deserialize;
use tonic::{Code, Status};

use crate::service::context::ServiceContext;
use crate::service::proto::{UrlInfoRequest, UrlInfoResponse};
use crate::util::{http_client, scraper};

const MAX_CACHED_URLS: u64 = 10_000;
const EVICTION_BATCH: u64 = 100;
const SUCCESS_TTL: TimeDelta = TimeDelta::hours(24);
const FAILURE_TTL: TimeDelta = TimeDelta::minutes(10);

/// A cached scrape outcome. Failures the scraper reported for the URL
/// are cached too (with a shorter TTL) so a dead or slow URL doesn't
/// get re-scraped on every request; failures to reach the scraper at
/// all are never cached (see `ScrapeFailure`).
type ScrapeOutcome = Result<UrlInfoResponse, (Code, String)>;

/// Why a scrape failed: `Reported` means the scraper answered for this
/// URL (a property of the target, cacheable); `Unreachable` means the
/// scraper couldn't be reached or gave an unusable response (transient
/// infrastructure trouble, never cached).
#[derive(Debug)]
enum ScrapeFailure {
    Reported(Status),
    Unreachable(Status),
}

fn ttl(row: &url_info_cache_model::Model) -> TimeDelta {
    if row.error_code.is_some() {
        FAILURE_TTL
    } else {
        SUCCESS_TTL
    }
}

/// Read a fresh cached outcome for `url`. Expired rows and database
/// errors are both treated as cache misses.
async fn get_cached(db: &DbConn, url: &str) -> Option<ScrapeOutcome> {
    let row = url_info_cache_model::Entity::find_by_id(url)
        .one(db)
        .await
        .map_err(|e| tracing::warn!(error = %e, "url_info cache lookup failed"))
        .ok()??;

    if Utc::now().signed_duration_since(row.updated_at) >= ttl(&row) {
        return None;
    }

    Some(match row.error_code {
        Some(code) => {
            Err((Code::from(code), row.error_message.unwrap_or_default()))
        }
        None => Ok(UrlInfoResponse {
            title: row.title,
            description: row.description,
            image: row.image,
        }),
    })
}

/// Upsert an outcome for `url`, evicting the oldest rows once the
/// cache is full. All statements are best-effort: failures are logged
/// and the response is served regardless.
async fn insert_cached(
    db: &DbConn,
    url: &str,
    outcome: &ScrapeOutcome,
    raw_response: Option<String>,
) {
    evict_if_full(db).await;

    let now = Utc::now();

    let (title, description, image, error_code, error_message) = match outcome {
        Ok(resp) => (
            resp.title.clone(),
            resp.description.clone(),
            resp.image.clone(),
            None,
            None,
        ),
        Err((code, message)) => (
            String::new(),
            String::new(),
            String::new(),
            Some(*code as i32),
            Some(message.clone()),
        ),
    };

    let row = url_info_cache_model::ActiveModel {
        url: Set(url.to_owned()),
        title: Set(title),
        description: Set(description),
        image: Set(image),
        raw_response: Set(raw_response),
        error_code: Set(error_code),
        error_message: Set(error_message),
        created_at: Set(now),
        updated_at: Set(now),
    };

    let insert = url_info_cache_model::Entity::insert(row)
        .on_conflict(
            OnConflict::column(url_info_cache_model::Column::Url)
                .update_columns([
                    url_info_cache_model::Column::Title,
                    url_info_cache_model::Column::Description,
                    url_info_cache_model::Column::Image,
                    url_info_cache_model::Column::RawResponse,
                    url_info_cache_model::Column::ErrorCode,
                    url_info_cache_model::Column::ErrorMessage,
                    url_info_cache_model::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec_without_returning(db)
        .await;
    if let Err(e) = insert {
        tracing::warn!(error = %e, "url_info cache insert failed");
    }
}

/// Delete the `EVICTION_BATCH` oldest rows once the cache holds at
/// least `MAX_CACHED_URLS` entries.
async fn evict_if_full(db: &DbConn) {
    let count = match url_info_cache_model::Entity::find().count(db).await {
        Ok(count) => count,
        Err(e) => {
            tracing::warn!(error = %e, "url_info cache count failed");
            return;
        }
    };
    if count < MAX_CACHED_URLS {
        return;
    }

    let oldest = SeaQuery::select()
        .column(url_info_cache_model::Column::Url)
        .from(url_info_cache_model::Entity)
        .order_by(url_info_cache_model::Column::UpdatedAt, Order::Asc)
        .limit(EVICTION_BATCH)
        .to_owned();
    let evicted = url_info_cache_model::Entity::delete_many()
        .filter(url_info_cache_model::Column::Url.in_subquery(oldest))
        .exec(db)
        .await;
    if let Err(e) = evicted {
        tracing::warn!(error = %e, "url_info cache eviction failed");
    }
}

/// JSON returned by the scraper service's `/scrape` endpoint.
#[derive(Deserialize)]
struct ScrapedMetadata {
    title: Option<String>,
    description: Option<String>,
    image: Option<String>,
}

pub async fn handle(
    ctx: &ServiceContext,
    req: UrlInfoRequest,
) -> Result<UrlInfoResponse, Status> {
    lookup(ctx, &scraper::scrape_url(), &req.url).await
}

/// Serve from cache, scraping on a miss. Concurrent misses for the
/// same key may each scrape; the last result wins.
async fn lookup(
    ctx: &ServiceContext,
    scrape_url: &str,
    target_url: &str,
) -> Result<UrlInfoResponse, Status> {
    let key = target_url.trim();

    if let Some(outcome) = get_cached(&ctx.ro_db, key).await {
        return outcome.map_err(|(code, message)| Status::new(code, message));
    }

    let (outcome, raw_response) = match fetch_metadata(scrape_url, key).await {
        Ok((resp, raw)) => (Ok(resp), Some(raw)),
        Err(ScrapeFailure::Unreachable(status)) => return Err(status),
        Err(ScrapeFailure::Reported(status)) => {
            (Err((status.code(), status.message().to_string())), None)
        }
    };

    insert_cached(&ctx.db, key, &outcome, raw_response).await;
    outcome.map_err(|(code, message)| Status::new(code, message))
}

/// Call the scraper's `/scrape` endpoint and map its JSON onto a
/// `UrlInfoResponse`, returned alongside the raw response body.
async fn fetch_metadata(
    scrape_url: &str,
    target_url: &str,
) -> Result<(UrlInfoResponse, String), ScrapeFailure> {
    let resp = http_client::client()
        .get(scrape_url)
        .query(&[("url", target_url)])
        .send()
        .await
        .map_err(|e| {
            ScrapeFailure::Unreachable(Status::unavailable(format!(
                "scraper request failed: {e}"
            )))
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        // The scraper now propagates the *target's* status: a 4xx is the target's
        // own response (gone/forbidden/rate-limited) — a property of the URL, so
        // cacheable; a 5xx means the scraper itself failed to fetch — transient
        // infra trouble, so never cached and surfaced as unreachable.
        return Err(if status.is_server_error() {
            ScrapeFailure::Unreachable(Status::unavailable(format!(
                "scraper failed to fetch target (status {status})"
            )))
        } else {
            ScrapeFailure::Reported(Status::unavailable(format!(
                "target responded with status {status}"
            )))
        });
    }

    let raw = resp.text().await.map_err(|e| {
        ScrapeFailure::Unreachable(Status::internal(format!(
            "invalid scraper response: {e}"
        )))
    })?;
    let meta: ScrapedMetadata = serde_json::from_str(&raw).map_err(|e| {
        ScrapeFailure::Unreachable(Status::internal(format!(
            "invalid scraper response: {e}"
        )))
    })?;

    let response = UrlInfoResponse {
        title: meta.title.unwrap_or_default(),
        description: meta.description.unwrap_or_default(),
        image: meta.image.unwrap_or_default(),
    };
    Ok((response, raw))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{
        DatabaseConnection, DbBackend, MockDatabase, MockExecResult,
    };
    use tonic::Code;

    // Each test gets its own mock server (own port) and passes its URL
    // directly, so there's no shared global state — they run in parallel.

    #[tokio::test]
    async fn maps_scraper_metadata_onto_response() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/scrape")
            // Confirms `handle` forwards the requested URL as the `url` param.
            .match_query(mockito::Matcher::UrlEncoded(
                "url".into(),
                "https://example.com".into(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"title":"Example","description":"Desc","image":"https://img/x.png"}"#,
            )
            .create_async()
            .await;

        let scrape_url = format!("{}/scrape", server.url());
        let (resp, raw) = fetch_metadata(&scrape_url, "https://example.com")
            .await
            .expect("should map metadata");

        assert_eq!(resp.title, "Example");
        assert_eq!(resp.description, "Desc");
        assert_eq!(resp.image, "https://img/x.png");
        assert_eq!(
            raw,
            r#"{"title":"Example","description":"Desc","image":"https://img/x.png"}"#,
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn missing_fields_default_to_empty_strings() {
        let mut server = mockito::Server::new_async().await;
        // Bound to a variable: a dropped Mock is removed from the server.
        let _mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"title":"Only title"}"#)
            .create_async()
            .await;

        let scrape_url = format!("{}/scrape", server.url());
        let (resp, _raw) = fetch_metadata(&scrape_url, "https://x.test")
            .await
            .expect("should map metadata");

        assert_eq!(resp.title, "Only title");
        assert_eq!(resp.description, "");
        assert_eq!(resp.image, "");
    }

    #[tokio::test]
    async fn non_success_status_is_unavailable() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::Any)
            .with_status(502)
            .create_async()
            .await;

        let scrape_url = format!("{}/scrape", server.url());
        let err = fetch_metadata(&scrape_url, "https://x.test")
            .await
            .expect_err("non-2xx should error");

        let ScrapeFailure::Reported(status) = err else {
            panic!("non-2xx should be a Reported failure");
        };
        assert_eq!(status.code(), Code::Unavailable);
    }

    fn success_body(title: &str) -> String {
        format!(r#"{{"title":"{title}","description":"","image":""}}"#)
    }

    fn cached_row(
        url: &str,
        title: &str,
        updated_at: chrono::DateTime<Utc>,
    ) -> url_info_cache_model::Model {
        url_info_cache_model::Model {
            url: url.to_string(),
            title: title.to_string(),
            description: String::new(),
            image: String::new(),
            raw_response: None,
            error_code: None,
            error_message: None,
            created_at: updated_at,
            updated_at,
        }
    }

    fn exec_ok() -> MockExecResult {
        MockExecResult {
            last_insert_id: 0,
            rows_affected: 1,
        }
    }

    fn count_row(
        count: i64,
    ) -> std::collections::BTreeMap<&'static str, sea_orm::Value> {
        std::collections::BTreeMap::from([(
            "num_items",
            sea_orm::Value::BigInt(Some(count)),
        )])
    }

    /// A mock connection expecting one miss-then-scrape lookup: a SELECT
    /// returning `first_select`, the row count, then the upsert.
    fn db_for_one_miss(
        first_select: Vec<url_info_cache_model::Model>,
    ) -> DatabaseConnection {
        MockDatabase::new(DbBackend::Postgres)
            .append_query_results([first_select])
            .append_query_results([vec![count_row(0)]])
            .append_exec_results([exec_ok()])
            .into_connection()
    }

    #[tokio::test]
    async fn second_lookup_is_served_from_cache() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(success_body("Cached"))
            .expect(1)
            .create_async()
            .await;

        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([Vec::<url_info_cache_model::Model>::new()])
            .append_query_results([vec![count_row(0)]])
            .append_query_results([vec![cached_row(
                "https://example.com",
                "Cached",
                Utc::now(),
            )]])
            .append_exec_results([exec_ok()])
            .into_connection();

        let scrape_url = format!("{}/scrape", server.url());
        let first = lookup(&db, &scrape_url, "https://example.com")
            .await
            .expect("first lookup should succeed");
        let second = lookup(&db, &scrape_url, "https://example.com")
            .await
            .expect("second lookup should succeed");

        assert_eq!(first.title, "Cached");
        assert_eq!(second.title, "Cached");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn expired_rows_are_refetched() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(success_body("Fresh"))
            .expect(1)
            .create_async()
            .await;

        let stale = Utc::now() - SUCCESS_TTL - TimeDelta::minutes(1);
        let db = db_for_one_miss(vec![cached_row(
            "https://example.com",
            "Stale",
            stale,
        )]);

        let scrape_url = format!("{}/scrape", server.url());
        let resp = lookup(&db, &scrape_url, "https://example.com")
            .await
            .expect("expired row should be refetched");

        assert_eq!(resp.title, "Fresh");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn full_cache_evicts_a_batch_of_oldest_rows() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(success_body("Evicting"))
            .expect(1)
            .create_async()
            .await;

        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([Vec::<url_info_cache_model::Model>::new()])
            .append_query_results([vec![count_row(MAX_CACHED_URLS as i64)]])
            .append_exec_results([exec_ok(), exec_ok()])
            .into_connection();

        let scrape_url = format!("{}/scrape", server.url());
        let resp = lookup(&db, &scrape_url, "https://example.com")
            .await
            .expect("lookup should succeed");
        assert_eq!(resp.title, "Evicting");
        mock.assert_async().await;

        let statements = db.into_transaction_log();
        let eviction = statements
            .iter()
            .find(|statement| format!("{statement:?}").contains("DELETE"));
        let eviction_sql = format!(
            "{:?}",
            eviction.expect("a full cache should issue an eviction DELETE")
        );
        assert!(eviction_sql.contains("ORDER BY"));
        assert!(eviction_sql.contains("LIMIT"));
    }

    #[tokio::test]
    async fn failures_are_cached() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::Any)
            .with_status(502)
            .expect(1)
            .create_async()
            .await;

        let failure_row = url_info_cache_model::Model {
            error_code: Some(Code::Unavailable as i32),
            error_message: Some("scraper returned status 502".to_string()),
            ..cached_row("https://dead.test", "", Utc::now())
        };
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([Vec::<url_info_cache_model::Model>::new()])
            .append_query_results([vec![count_row(0)]])
            .append_query_results([vec![failure_row]])
            .append_exec_results([exec_ok()])
            .into_connection();

        let scrape_url = format!("{}/scrape", server.url());
        let first = lookup(&db, &scrape_url, "https://dead.test")
            .await
            .expect_err("first lookup should fail");
        let second = lookup(&db, &scrape_url, "https://dead.test")
            .await
            .expect_err("second lookup should fail");

        assert_eq!(first.code(), Code::Unavailable);
        assert_eq!(second.code(), Code::Unavailable);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn surrounding_whitespace_is_trimmed_before_scraping() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::UrlEncoded(
                "url".into(),
                "https://example.com/page".into(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(success_body("Normalized"))
            .expect(1)
            .create_async()
            .await;

        let db = db_for_one_miss(Vec::new());

        let scrape_url = format!("{}/scrape", server.url());
        let resp = lookup(&db, &scrape_url, " https://example.com/page ")
            .await
            .expect("padded URL should be trimmed and scraped");

        assert_eq!(resp.title, "Normalized");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn malformed_body_is_internal() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body("not json")
            .create_async()
            .await;

        let scrape_url = format!("{}/scrape", server.url());
        let err = fetch_metadata(&scrape_url, "https://x.test")
            .await
            .expect_err("invalid JSON should error");

        let ScrapeFailure::Unreachable(status) = err else {
            panic!("a malformed body should be an Unreachable failure");
        };
        assert_eq!(status.code(), Code::Internal);
    }

    #[tokio::test]
    async fn unreachable_scraper_failures_are_not_cached() {
        // Two SELECT misses but only ONE count+upsert set: if the failed
        // first lookup wrote to the cache, the second lookup's statements
        // would find no mock results and the test would fail.
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([
                Vec::<url_info_cache_model::Model>::new(),
                Vec::<url_info_cache_model::Model>::new(),
            ])
            .append_query_results([vec![count_row(0)]])
            .append_exec_results([exec_ok()])
            .into_connection();

        let refused =
            lookup(&db, "http://127.0.0.1:1/scrape", "https://example.com")
                .await
                .expect_err("unreachable scraper should fail");
        assert_eq!(refused.code(), Code::Unavailable);

        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/scrape")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(success_body("Recovered"))
            .expect(1)
            .create_async()
            .await;

        let scrape_url = format!("{}/scrape", server.url());
        let recovered = lookup(&db, &scrape_url, "https://example.com")
            .await
            .expect("retry after recovery should succeed");

        assert_eq!(recovered.title, "Recovered");
        mock.assert_async().await;
    }
}
