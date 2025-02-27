use polycentric_protocol::model::{
    known_message_types, pointer, public_key, reference,
};

fn signed_event_to_cache_tags(
    signed_event: &polycentric_protocol::model::signed_event::SignedEvent,
    invalidate_user_content_type: bool,
    invalidate_event: bool,
    invalidate_reference: bool,
    invalidate_user_meta: bool,
) -> Vec<String> {
    let mut out = Vec::new();

    if let Ok(event) =
        polycentric_protocol::model::event::from_vec(signed_event.event())
    {
        // Handle content type-based tags
        match *event.content_type() {
            known_message_types::POST
            | known_message_types::DELETE
            | known_message_types::CLAIM
            | known_message_types::VOUCH => {
                // pkey-{content_type}-{pkey} for feeds
                if invalidate_user_content_type {
                    if let Ok(key_str) = public_key::to_base64(event.system()) {
                        out.push(format!(
                            "pkey-{}-{}",
                            event.content_type(),
                            key_str
                        ));
                    }
                }
                // pointer-{pointer} for the post itself, and any events it may delete
                if invalidate_event {
                    if let Ok(pointer) =
                        pointer::from_signed_event(signed_event)
                    {
                        if let Ok(base64_pointer) = pointer::to_base64(&pointer)
                        {
                            out.push(format!("pointer-{}", base64_pointer));
                        }
                    }
                    if *event.content_type() == known_message_types::DELETE {
                        for reference in event.references() {
                            if let Ok(base64) = reference::to_base64(reference)
                            {
                                out.push(format!("pointer-{}", base64));
                            }
                        }
                    }
                }
            }
            known_message_types::USERNAME
            | known_message_types::AVATAR
            | known_message_types::BANNER
            | known_message_types::DESCRIPTION
            | known_message_types::SERVER => {
                // pkey-{content_type}-{pkey} for the user
                if invalidate_user_content_type {
                    if let Ok(key_str) = public_key::to_base64(event.system()) {
                        out.push(format!(
                            "pkey-{}-{}",
                            event.content_type(),
                            key_str
                        ));
                    }
                }
            }
            _ => {}
        }

        // Add reference tags if requested
        if invalidate_reference {
            for reference in event.references() {
                if let Ok(base64) = reference::to_base64(reference) {
                    out.push(format!("ref-{}", base64));
                }
            }
        }

        // Add account meta tag if requested
        if invalidate_user_meta {
            if let Ok(key_str) = public_key::to_base64(event.system()) {
                out.push(format!("pkey-meta-{}", key_str));
            }
        }
    }

    out
}

pub(crate) fn signed_events_to_cache_tags(
    signed_events: &[polycentric_protocol::model::signed_event::SignedEvent],
    invalidate_user_content_type: bool,
    invalidate_event: bool,
    invalidate_reference: bool,
    invalidate_user_meta: bool,
) -> Vec<String> {
    let mut tags: Vec<String> = signed_events
        .iter()
        .flat_map(|event| {
            signed_event_to_cache_tags(
                event,
                invalidate_user_content_type,
                invalidate_event,
                invalidate_reference,
                invalidate_user_meta,
            )
        })
        .collect();

    // deduplicate tags
    tags.sort();
    tags.dedup();

    tags
}
