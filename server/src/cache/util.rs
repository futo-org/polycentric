use polycentric_protocol::model::{
    known_message_types, pointer, public_key, reference,
};

pub(crate) fn signed_event_to_cache_tags(
    signed_event: &polycentric_protocol::model::signed_event::SignedEvent,
) -> Vec<String> {
    let event =
        polycentric_protocol::model::event::from_vec(signed_event.event());

    let mut out = Vec::new();
    if let Ok(event) = event {
        match *event.content_type() {
            // For posts and claims, the cache tag is the post id
            known_message_types::POST
            | known_message_types::DELETE
            | known_message_types::CLAIM
            | known_message_types::VOUCH => {
                // pkey:{content_type}:{pkey} to invalidate the feeds
                // pointer:{pointer} to invalidate the post

                let key_str = public_key::to_base64(event.system());

                if let Ok(key_str) = key_str {
                    out.push(format!(
                        "pkey:{}:{}",
                        event.content_type(),
                        key_str
                    ));
                }

                let pointer = pointer::from_signed_event(signed_event);
                if let Ok(pointer) = pointer {
                    let base64_pointer = pointer::to_base64(&pointer);
                    if let Ok(base64_pointer) = base64_pointer {
                        out.push(format!("pointer:{}", base64_pointer));
                    }
                }
            }
            known_message_types::USERNAME
            | known_message_types::AVATAR
            | known_message_types::BANNER
            | known_message_types::DESCRIPTION
            | known_message_types::SERVER => {
                // pkey:{content_type}:{pkey} to invalidate the user
                let key_str = public_key::to_base64(event.system());
                if let Ok(key_str) = key_str {
                    out.push(format!(
                        "pkey:{}:{}",
                        event.content_type(),
                        key_str
                    ));
                }
            }
            _ => {}
        }
    }

    out
}

// For routes like get_head and get_ranges, where we want to invalidate the whole account
// for exclusively these routes
pub(crate) fn key_to_cache_tags_account_meta(
    system: &public_key::PublicKey,
) -> Vec<String> {
    let mut out = Vec::new();
    let key_str = public_key::to_base64(system);
    if let Ok(key_str) = key_str {
        out.push(format!("pkey:meta:{}", key_str));
    }
    out
}

pub(crate) fn ingested_signed_event_to_cache_tags_account_meta(
    signed_event: &polycentric_protocol::model::signed_event::SignedEvent,
) -> Vec<String> {
    let event =
        polycentric_protocol::model::event::from_vec(signed_event.event());

    if let Ok(event) = event {
        return key_to_cache_tags_account_meta(&event.system());
    }
    Vec::new()
}

pub(crate) fn reference_to_cache_tags_reference(
    reference: &reference::Reference,
) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(base64) = reference::to_base64(reference) {
        out.push(format!("ref:{}", base64));
    }
    out
}

pub(crate) fn ingested_signed_event_to_cache_tags_reference(
    signed_event: &polycentric_protocol::model::signed_event::SignedEvent,
) -> Vec<String> {
    let event =
        polycentric_protocol::model::event::from_vec(signed_event.event());

    let mut out = Vec::new();
    if let Ok(event) = event {
        for reference in event.references() {
            out.extend(reference_to_cache_tags_reference(&reference));
        }
    }
    out
}
