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
struct Found {
    start: usize,
    end: usize,
    mention: Mention,
    rendered: String,
}

/// Curly mentions first so one is taken whole; then any other `@` run.
static MENTION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"@\{[^}]+\}|@\S+").unwrap());

/// Punctuation that commonly trails a mention in prose but isn't part of it.
const TRAILING_PUNCT: &[char] = &['.', ',', '!', '?', ';', ':', '\'', '"', ')', ']', '}'];

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A char that glues an `@` to the preceding word, disqualifying it as a
/// mention (the client's `TOKEN_PRECEDER`).
fn glues(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '@'
}

fn scan(text: &str) -> Vec<Found> {
    MENTION
        .find_iter(text)
        .filter_map(|m| {
            if text[..m.start()].chars().next_back().is_some_and(glues) {
                return None;
            }
            let mut raw = m.as_str();
            let is_curly = raw.starts_with("@{") && raw.ends_with('}');
            if !is_curly {
                raw = raw.trim_end_matches(TRAILING_PUNCT);
            }

            let (mention, rendered) = if is_curly {
                let content = &raw[2..raw.len() - 1];
                let (identity, name) = match content.split_once(',') {
                    Some((identity, name)) => (identity, name),
                    None => (content, ""),
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
                let body = &raw[1..];
                let mention = if is_hex64(body) {
                    Mention::Identity(body.to_string())
                } else if body.contains('.') {
                    Mention::Alias(body.to_string())
                } else {
                    return None;
                };
                (mention, raw.to_string())
            };

            Some(Found {
                start: m.start(),
                end: m.start() + raw.len(),
                mention,
                rendered,
            })
        })
        .collect()
}

/// Every mention in `text`, in order of appearance, duplicates included.
pub fn extract_mentions(text: &str) -> Vec<Mention> {
    scan(text).into_iter().map(|f| f.mention).collect()
}

/// `text` as the client renders it: `@{<64 hex>,Name}` becomes `Name` and
/// `@{<64 hex>}` becomes `@<64 hex>`. Anything else, including a malformed
/// `@{...}`, stays as is.
pub fn mentions_to_plain_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for f in scan(text) {
        out.push_str(&text[last..f.start]);
        out.push_str(&f.rendered);
        last = f.end;
    }
    out.push_str(&text[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex() -> String {
        "a".repeat(64)
    }

    #[test]
    fn extracts_every_supported_form() {
        let hex = hex();
        let text = format!("hi @{{{hex},Jane Doe}} @{{{hex}}} @{hex} @bob@example.com, @ex.org!");
        assert_eq!(
            extract_mentions(&text),
            vec![
                Mention::Identity(hex.clone()),
                Mention::Identity(hex.clone()),
                Mention::Identity(hex),
                Mention::Alias("bob@example.com".into()),
                Mention::Alias("ex.org".into()),
            ]
        );
    }

    #[test]
    fn skips_emails_bare_words_and_malformed_curlies() {
        let text = format!("mail a@b.com or @nodot; @{{nope,x}} @{{{}", hex());
        assert!(extract_mentions(&text).is_empty());
    }

    #[test]
    fn renders_curly_mentions_as_display_names() {
        let hex = hex();
        let text =
            format!("hi @{{{hex},Jane Doe}} and @{{{hex}}} not @{{nope,x}} @{{{hex} a@{{{hex}}}");
        assert_eq!(
            mentions_to_plain_text(&text),
            format!("hi Jane Doe and @{hex} not @{{nope,x}} @{{{hex} a@{{{hex}}}")
        );
    }
}
