//! Renders a notification into the kind-specific parts of a push message.

use std::sync::LazyLock;

use polycentric_common::models::protos_v2::{
    Content, EventKey, NotificationKind, content::ContentBody,
};
use regex::{Captures, Regex};

/// The kind-specific parts of a push message: the body text and the deep
/// link the notification opens.
pub struct Rendered {
    pub body: String,
    pub url: Option<String>,
}

/// The push message for a notification of `kind`, triggered by the event at
/// `key` carrying `content`. `None` for kinds that don't push.
pub fn render(kind: NotificationKind, key: &EventKey, content: &Content) -> Option<Rendered> {
    match kind {
        NotificationKind::Reply => {
            let Some(ContentBody::Post(post)) = &content.content_body else {
                return None;
            };
            Some(Rendered {
                body: match post.text.is_empty() {
                    true => "Replied to your post".to_string(),
                    false => format!("Replied: {}", mentions_to_plain_text(&post.text)),
                },
                // Deep link to the reply post itself.
                url: post_url(key),
            })
        }
        NotificationKind::Follow => Some(Rendered {
            body: "Followed you".to_string(),
            // Deep link to the follower's profile.
            url: Some(profile_url(&key.identity)),
        }),
        NotificationKind::Reaction => {
            let Some(ContentBody::Reaction(reaction)) = &content.content_body else {
                return None;
            };
            Some(Rendered {
                body: match &reaction.emoji {
                    Some(emoji) if !emoji.is_empty() => {
                        format!("Reacted {emoji} to your post")
                    }
                    _ => "Reacted to your post".to_string(),
                },
                // Deep link to the reacted-to post.
                url: reaction.event_key.as_ref().and_then(post_url),
            })
        }
        NotificationKind::VerificationRequest => {
            let Some(ContentBody::VerificationTarget(target)) = &content.content_body else {
                return None;
            };
            Some(Rendered {
                body: "Requested a verification from you".to_string(),
                url: claim_url(target.claim_event_key.as_ref()),
            })
        }
        NotificationKind::VerificationComplete => {
            let Some(ContentBody::VerificationVerify(verify)) = &content.content_body else {
                return None;
            };
            Some(Rendered {
                body: "Completed your verification request".to_string(),
                url: claim_url(verify.claim_event_key.as_ref()),
            })
        }
        _ => None,
    }
}

/// `text` as the client renders it: `@{<64 hex>,Name}` becomes `Name` and
/// `@{<64 hex>}` becomes `@<64 hex>`, mirroring `parseTextLinks`'s curly
/// mention form. Anything else, including a malformed `@{...}`, stays as is.
fn mentions_to_plain_text(text: &str) -> String {
    static CURLY_MENTION: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"@\{([0-9a-fA-F]{64})(?:,([^}]*))?\}").unwrap());
    CURLY_MENTION
        .replace_all(text, |c: &Captures| match c.get(2).map(|m| m.as_str()) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => format!("@{}", &c[1]),
        })
        .into_owned()
}

/// First 8 bytes of a signing key (`EventKey.signed_by`) as lowercase hex,
/// matching the client's `getKeyFingerprint`.
pub(crate) fn key_fingerprint(signing_key: &[u8]) -> String {
    hex::encode(&signing_key[0..signing_key.len().min(8)])
}

/// Deep link to the post at `key`, mirroring the client's
/// `Routes.tabs.post(identity, keyFingerprint, sequence)`. `None` when the
/// key carries no signing key.
///
/// `harbor` is the app's registered URL scheme (app.config.ts). The empty
/// authority (`:///`) makes expo-router parse the whole tail as the route
/// path.
fn post_url(key: &EventKey) -> Option<String> {
    let signed_by = key.signed_by.as_ref()?;
    let key_fingerprint = key_fingerprint(&signed_by.key);
    Some(format!(
        "harbor:///{}/post/{key_fingerprint}/{}",
        key.identity, key.sequence
    ))
}

/// Deep link to an identity's profile, mirroring the client's
/// `Routes.tabs.profile(identity)`.
fn profile_url(identity: &str) -> String {
    format!("harbor:///{identity}")
}

/// Deep link to a verification claim, mirroring the client's
/// `Routes.tabs.verification(identity, keyFingerprint, sequence)`. `None`
/// when the claim key is absent or carries no signing key.
fn claim_url(claim_key: Option<&EventKey>) -> Option<String> {
    let key = claim_key?;
    let signed_by = key.signed_by.as_ref()?;
    let key_fingerprint = key_fingerprint(&signed_by.key);
    Some(format!(
        "harbor:///{}/verifications/{key_fingerprint}/{}",
        key.identity, key.sequence
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use polycentric_common::models::protos_v2::{
        Post, PostReply, PublicKey, Reaction, Repost, VerificationTarget, VerificationVerify,
    };

    fn key(identity: &str) -> EventKey {
        EventKey {
            collection: 2,
            identity: identity.to_string(),
            signed_by: Some(PublicKey {
                key_type: 1,
                key: vec![0xAB; 32],
            }),
            sequence: 7,
        }
    }

    fn post(text: &str) -> Content {
        Content {
            content_body: Some(ContentBody::Post(Post {
                text: text.to_string(),
                reply: Some(PostReply {
                    root: None,
                    parent: Some(key("them")),
                }),
                images: vec![],
                links: vec![],
                quote: None,
                labels: vec![],
                attributed_to: vec![],
            })),
        }
    }

    #[test]
    fn reply_quotes_the_text_and_links_to_the_post() {
        let rendered =
            render(NotificationKind::Reply, &key("alice"), &post("hi")).expect("should render");
        assert_eq!(rendered.body, "Replied: hi");
        assert_eq!(
            rendered.url.as_deref(),
            Some("harbor:///alice/post/abababababababab/7")
        );
    }

    #[test]
    fn reply_renders_curly_mentions_as_display_names() {
        let hex = "a".repeat(64);
        let text = format!("hi @{{{hex},Jane Doe}} and @{{{hex}}} not @{{nope,x}} @{{{hex}");
        let rendered =
            render(NotificationKind::Reply, &key("alice"), &post(&text)).expect("should render");
        assert_eq!(
            rendered.body,
            format!("Replied: hi Jane Doe and @{hex} not @{{nope,x}} @{{{hex}")
        );
    }

    #[test]
    fn reply_without_text_uses_the_generic_body() {
        let rendered =
            render(NotificationKind::Reply, &key("alice"), &post("")).expect("should render");
        assert_eq!(rendered.body, "Replied to your post");
    }

    #[test]
    fn reply_without_a_signing_key_has_no_link() {
        let mut unsigned = key("alice");
        unsigned.signed_by = None;
        let rendered =
            render(NotificationKind::Reply, &unsigned, &post("hi")).expect("should render");
        assert_eq!(rendered.url, None);
    }

    #[test]
    fn reaction_carries_the_emoji_and_links_to_the_reacted_post() {
        let content = Content {
            content_body: Some(ContentBody::Reaction(Reaction {
                event_key: Some(key("me")),
                emoji: Some("👍".to_string()),
                positive: true,
            })),
        };
        let rendered =
            render(NotificationKind::Reaction, &key("alice"), &content).expect("should render");
        assert_eq!(rendered.body, "Reacted 👍 to your post");
        assert_eq!(
            rendered.url.as_deref(),
            Some("harbor:///me/post/abababababababab/7")
        );
    }

    #[test]
    fn reaction_without_an_emoji_uses_the_generic_body() {
        let content = Content {
            content_body: Some(ContentBody::Reaction(Reaction {
                event_key: Some(key("me")),
                emoji: None,
                positive: true,
            })),
        };
        let rendered =
            render(NotificationKind::Reaction, &key("alice"), &content).expect("should render");
        assert_eq!(rendered.body, "Reacted to your post");
    }

    #[test]
    fn follow_links_to_the_follower_profile() {
        let content = Content { content_body: None };
        let rendered =
            render(NotificationKind::Follow, &key("alice"), &content).expect("should render");
        assert_eq!(rendered.body, "Followed you");
        assert_eq!(rendered.url.as_deref(), Some("harbor:///alice"));
    }

    #[test]
    fn verification_request_links_to_the_claim() {
        let content = Content {
            content_body: Some(ContentBody::VerificationTarget(VerificationTarget {
                claim_event_key: Some(key("alice")),
                target_identities: vec!["bob".to_string()],
            })),
        };
        let rendered = render(
            NotificationKind::VerificationRequest,
            &key("alice"),
            &content,
        )
        .expect("should render");
        assert_eq!(rendered.body, "Requested a verification from you");
        assert_eq!(
            rendered.url.as_deref(),
            Some("harbor:///alice/verifications/abababababababab/7")
        );
    }

    #[test]
    fn verification_complete_links_to_the_claim() {
        let content = Content {
            content_body: Some(ContentBody::VerificationVerify(VerificationVerify {
                claim_event_key: Some(key("alice")),
            })),
        };
        let rendered = render(
            NotificationKind::VerificationComplete,
            &key("bob"),
            &content,
        )
        .expect("should render");
        assert_eq!(rendered.body, "Completed your verification request");
        assert_eq!(
            rendered.url.as_deref(),
            Some("harbor:///alice/verifications/abababababababab/7")
        );
    }

    #[test]
    fn verification_without_a_claim_key_has_no_link() {
        let content = Content {
            content_body: Some(ContentBody::VerificationVerify(VerificationVerify {
                claim_event_key: None,
            })),
        };
        let rendered = render(
            NotificationKind::VerificationComplete,
            &key("bob"),
            &content,
        )
        .expect("should render");
        assert_eq!(rendered.url, None);
    }

    #[test]
    fn kinds_without_a_push_render_nothing() {
        let content = Content {
            content_body: Some(ContentBody::Repost(Repost { post: None })),
        };
        assert!(render(NotificationKind::Repost, &key("alice"), &content).is_none());
        assert!(render(NotificationKind::Quote, &key("alice"), &content).is_none());
        assert!(render(NotificationKind::Unspecified, &key("alice"), &content).is_none());
    }
}
