//! Alias resolution for mention notifications: `user@domain.com` resolves to
//! the identity listed under `names["user"]` in
//! `https://domain.com/.well-known/polycentric.json`, exactly as the client
//! does (`packages/js-core/src/http/alias-resolver.ts`). Keep the two in sync.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use serde::Deserialize;
use tokio::task::JoinSet;

/// Distinct domains one post may make the worker fetch from. One fetch
/// serves every alias at a domain; aliases at further domains are dropped.
const MAX_ALIAS_DOMAINS_PER_POST: usize = 10;

/// Largest `polycentric.json` body read; longer documents are dropped.
const MAX_DOCUMENT_BYTES: usize = 16 * 1024;

const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

/// HTTPS only, no redirects: post text picks the host, so the fetch stays
/// exactly where the alias points.
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(FETCH_TIMEOUT)
        .build()
        .expect("failed to build alias resolver HTTP client")
});

/// The identity each of `aliases` resolves to, keyed by the alias as given.
/// Malformed aliases, failed fetches and aliases the domain doesn't list are
/// absent. Domains are fetched concurrently.
pub async fn resolve_aliases(aliases: &[String]) -> HashMap<String, String> {
    resolve_aliases_with(&CLIENT, aliases, &|domain| {
        format!("https://{domain}")
    })
    .await
}

/// `resolve_aliases` with the client and the domain -> origin mapping
/// injected, so tests can point a domain at a local mock server.
async fn resolve_aliases_with(
    client: &reqwest::Client,
    aliases: &[String],
    origin_for_domain: &(dyn Fn(&str) -> String + Sync),
) -> HashMap<String, String> {
    // Aliases grouped by domain, in order of first mention.
    let mut aliases_by_domain: Vec<(String, Vec<(String, String)>)> =
        Vec::new();
    for alias in aliases {
        let Some(parsed) = parse_alias(alias) else {
            continue;
        };
        let domain_index = aliases_by_domain
            .iter()
            .position(|(domain, _)| *domain == parsed.domain);
        match domain_index {
            Some(i) => {
                aliases_by_domain[i].1.push((alias.clone(), parsed.local))
            }
            None if aliases_by_domain.len() < MAX_ALIAS_DOMAINS_PER_POST => {
                aliases_by_domain
                    .push((parsed.domain, vec![(alias.clone(), parsed.local)]));
            }
            None => {}
        }
    }

    let mut fetches = JoinSet::new();
    for (domain, aliases_at_domain) in aliases_by_domain {
        let client = client.clone();
        let url = format!(
            "{}/.well-known/polycentric.json",
            origin_for_domain(&domain)
        );
        fetches.spawn(async move {
            let names = fetch_alias_names(&client, &url)
                .await
                .map_err(|e| {
                    tracing::warn!(domain = %domain, error = %e, "alias lookup failed");
                })
                .unwrap_or_default();
            (aliases_at_domain, names)
        });
    }

    let mut identity_by_alias_map = HashMap::new();
    while let Some(Ok((aliases_at_domain, names))) = fetches.join_next().await {
        for (alias, local) in aliases_at_domain {
            if let Some(identity) =
                names.get(&local).filter(|id| is_identity_key(id))
            {
                identity_by_alias_map.insert(alias, identity.clone());
            }
        }
    }
    identity_by_alias_map
}

/// The `/.well-known/polycentric.json` document: alias local part -> identity.
#[derive(Deserialize, Default)]
struct AliasDocument {
    #[serde(default)]
    names: HashMap<String, String>,
}

/// The `names` map at `url`, or why it couldn't be read.
async fn fetch_alias_names(
    client: &reqwest::Client,
    url: &str,
) -> Result<HashMap<String, String>, String> {
    let mut response = client
        .get(url)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("status {}", response.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > MAX_DOCUMENT_BYTES {
            return Err(format!("body over {MAX_DOCUMENT_BYTES} bytes"));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice::<AliasDocument>(&body)
        .map(|doc| doc.names)
        .map_err(|e| e.to_string())
}

/// An alias split into the `names` key to look up and the domain serving it.
#[derive(Debug, PartialEq, Eq)]
struct ParsedAlias {
    /// Lowercased local part; `*` for a bare-domain alias.
    local: String,
    domain: String,
}

/// `user@domain.com` (optionally `@`-prefixed) or a bare `domain.com`, with
/// the client's allow-lists: local part of letters, digits, `._-`; domain of
/// two or more LDH labels. `None` otherwise.
fn parse_alias(alias: &str) -> Option<ParsedAlias> {
    let acct = alias.trim().strip_prefix('@').unwrap_or(alias.trim());
    let (local, domain) = match acct.split_once('@') {
        None => ("*".to_string(), acct),
        Some((local, domain)) => {
            if local.is_empty()
                || !local
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
            {
                return None;
            }
            (local.to_lowercase(), domain)
        }
    };
    if domain.contains('@') {
        return None;
    }
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 || !labels.iter().all(|label| is_host_label(label)) {
        return None;
    }
    Some(ParsedAlias {
        local,
        domain: domain.to_string(),
    })
}

/// A DNS label: one or more of `[A-Za-z0-9-]`, not starting or ending with a
/// hyphen.
fn is_host_label(label: &str) -> bool {
    !label.is_empty()
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Whether `s` is a polycentric identity string (non-empty hex).
fn is_identity_key(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(local: &str, domain: &str) -> Option<ParsedAlias> {
        Some(ParsedAlias {
            local: local.to_string(),
            domain: domain.to_string(),
        })
    }

    #[test]
    fn parses_aliases_like_the_client() {
        assert_eq!(parse_alias("bob@x.com"), parsed("bob", "x.com"));
        assert_eq!(
            parse_alias(" @Bob.Smith@Sub.X.com "),
            parsed("bob.smith", "Sub.X.com")
        );
        assert_eq!(parse_alias("x.com"), parsed("*", "x.com"));
        assert_eq!(parse_alias("@x.com"), parsed("*", "x.com"));
        for malformed in [
            "",
            "@",
            "bob@x",
            "bob@x..com",
            "bob@-x.com",
            "bob@x-.com",
            "bob@x.com@y.com",
            "@x.com@",
            "bo b@x.com",
            "bob!@x.com",
            "bob@x.c om",
            "bob@",
        ] {
            assert_eq!(parse_alias(malformed), None, "{malformed:?}");
        }
    }

    /// The client is local-only in tests (mockito serves HTTP).
    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(FETCH_TIMEOUT)
            .build()
            .unwrap()
    }

    fn aliases(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    async fn resolve_against(
        server: &mockito::ServerGuard,
        list: &[&str],
    ) -> HashMap<String, String> {
        let origin = server.url();
        resolve_aliases_with(&test_client(), &aliases(list), &|_| {
            origin.clone()
        })
        .await
    }

    #[tokio::test]
    async fn one_fetch_per_domain_resolves_every_listed_alias() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/.well-known/polycentric.json")
            .expect(1)
            .with_body(
                r#"{"names":{"bob":"abc123","*":"DEF","carol":"not hex"}}"#,
            )
            .create_async()
            .await;

        let identity_by_alias_map = resolve_against(
            &server,
            &[
                "bob@x.com",
                "x.com",
                "carol@x.com",
                "dave@x.com",
                "malformed@x",
            ],
        )
        .await;

        assert_eq!(
            identity_by_alias_map,
            HashMap::from([
                ("bob@x.com".to_string(), "abc123".to_string()),
                ("x.com".to_string(), "DEF".to_string()),
            ])
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn a_failed_or_unusable_fetch_resolves_nothing() {
        for (status, body) in [
            (404, r#"{"names":{"bob":"abc"}}"#),
            (200, "not json"),
            (200, r#"{"other":1}"#),
        ] {
            let mut server = mockito::Server::new_async().await;
            server
                .mock("GET", "/.well-known/polycentric.json")
                .with_status(status)
                .with_body(body)
                .create_async()
                .await;
            assert!(
                resolve_against(&server, &["bob@x.com"]).await.is_empty(),
                "status {status}, body {body:?}"
            );
        }
    }

    #[tokio::test]
    async fn an_oversized_document_is_dropped() {
        let mut server = mockito::Server::new_async().await;
        let padding = " ".repeat(MAX_DOCUMENT_BYTES);
        server
            .mock("GET", "/.well-known/polycentric.json")
            .with_body(format!(r#"{{"names":{{"bob":"abc"}}{padding}}}"#))
            .create_async()
            .await;
        assert!(resolve_against(&server, &["bob@x.com"]).await.is_empty());
    }

    #[tokio::test]
    async fn domains_past_the_cap_are_not_fetched() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/.well-known/polycentric.json")
            .expect(MAX_ALIAS_DOMAINS_PER_POST)
            .with_body(r#"{"names":{"bob":"abc"}}"#)
            .create_async()
            .await;

        let list: Vec<String> = (0..MAX_ALIAS_DOMAINS_PER_POST + 2)
            .map(|i| format!("bob@d{i}.com"))
            .collect();
        let origin = server.url();
        let identity_by_alias_map =
            resolve_aliases_with(&test_client(), &list, &|_| origin.clone())
                .await;

        assert_eq!(identity_by_alias_map.len(), MAX_ALIAS_DOMAINS_PER_POST);
        assert!(
            !identity_by_alias_map
                .contains_key(&list[MAX_ALIAS_DOMAINS_PER_POST])
        );
        mock.assert_async().await;
    }
}
