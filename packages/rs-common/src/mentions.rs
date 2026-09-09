//! Mentions in post text, mirroring the client's `parseTextLinks`
//! (`apps/harbor/src/common/util/parseTextLinks.ts`). Keep the two in sync.
//!
//! A standalone `@` (not glued to a preceding word character, so an email's
//! `@` never starts one) begins a mention:
//! - `@{<64 hex>,Name}` / `@{<64 hex>}` — identity mention, rendered as the
//!   bare name (or `@<64 hex>` without one).
//! - `@<64 hex>` — identity mention.
//! - anything else containing a dot (`@user@domain.com`) — alias mention.
//! - otherwise plain text.

use std::sync::LazyLock;

use regex::Regex;

/// Who a mention refers to.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Mention {
    /// A polycentric identity (64 hex chars).
    Identity(String),
    /// A domain alias such as `user@domain.com`, as written.
    Alias(String),
}

/// A mention found in text: its byte range and how the client renders it.
struct FoundMention {
    start: usize,
    end: usize,
    mention: Mention,
    rendered: String,
}

/// Curly mentions first so one is taken whole; then any other `@` run.
static MENTION_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"@\{[^}]+\}|@\S+").unwrap());

/// Punctuation that commonly trails a mention in prose but isn't part of it.
const TRAILING_PUNCT: &[char] = &['.', ',', '!', '?', ';', ':', '\'', '"', ')', ']', '}'];

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A char that glues an `@` to the preceding word, disqualifying it as a
/// mention (the client's `TOKEN_PRECEDER`).
fn is_mention_preceder(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '@'
}

fn scan_mentions(text: &str) -> Vec<FoundMention> {
    MENTION_REGEX
        .find_iter(text)
        .filter_map(|m| {
            if text[..m.start()]
                .chars()
                .next_back()
                .is_some_and(is_mention_preceder)
            {
                return None;
            }
            let mut raw_mention = m.as_str();
            let is_curly = raw_mention.starts_with("@{") && raw_mention.ends_with('}');
            if !is_curly {
                raw_mention = raw_mention.trim_end_matches(TRAILING_PUNCT);
            }

            let (mention, rendered) = if is_curly {
                let curly_body = &raw_mention[2..raw_mention.len() - 1];
                let (identity, name) = match curly_body.split_once(',') {
                    Some((identity, name)) => (identity, name),
                    None => (curly_body, ""),
                };
                if !is_hex64(identity) {
                    return None;
                }
                let rendered = match name.is_empty() {
                    true => format!("@{identity}"),
                    false => name.to_string(),
                };
                (Mention::Identity(identity.to_string()), rendered)
            } else {
                let body = &raw_mention[1..];
                let mention = if is_hex64(body) {
                    Mention::Identity(body.to_string())
                } else if body.contains('.') {
                    Mention::Alias(body.to_string())
                } else {
                    return None;
                };
                (mention, raw_mention.to_string())
            };

            Some(FoundMention {
                start: m.start(),
                end: m.start() + raw_mention.len(),
                mention,
                rendered,
            })
        })
        .collect()
}

/// Every mention in `text`, in order of appearance, duplicates included.
pub fn extract_mentions(text: &str) -> Vec<Mention> {
    scan_mentions(text).into_iter().map(|f| f.mention).collect()
}

/// `text` as the client renders it: `@{<64 hex>,Name}` becomes `Name` and
/// `@{<64 hex>}` becomes `@<64 hex>`. Anything else, including a malformed
/// `@{...}`, stays as is.
pub fn mentions_to_plain_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut copied_up_to = 0;
    for f in scan_mentions(text) {
        out.push_str(&text[copied_up_to..f.start]);
        out.push_str(&f.rendered);
        copied_up_to = f.end;
    }
    out.push_str(&text[copied_up_to..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    /// Shared with the client's `parseTextLinks.test.ts`, which runs the same
    /// file — so both parsers agree on every case.
    const FIXTURES: &str = include_str!("mentions.fixtures.json");

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Expected {
        Identity { identity: String },
        Alias { alias: String },
    }

    #[derive(Deserialize)]
    struct Fixture {
        name: String,
        text: String,
        mentions: Vec<Expected>,
        plain: String,
    }

    #[test]
    fn matches_the_shared_fixtures() {
        let fixtures: Vec<Fixture> = serde_json::from_str(FIXTURES).unwrap();
        assert!(!fixtures.is_empty());
        for f in fixtures {
            let expected: Vec<Mention> = f
                .mentions
                .into_iter()
                .map(|m| match m {
                    Expected::Identity { identity } => Mention::Identity(identity),
                    Expected::Alias { alias } => Mention::Alias(alias),
                })
                .collect();
            assert_eq!(extract_mentions(&f.text), expected, "{}", f.name);
            assert_eq!(mentions_to_plain_text(&f.text), f.plain, "{}", f.name);
        }
    }
}
