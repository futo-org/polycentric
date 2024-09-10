use protobuf::Message;
use rand::Rng;

pub fn make_test_keypair() -> ::ed25519_dalek::SigningKey {
    ::ed25519_dalek::SigningKey::generate(&mut ::rand::thread_rng())
}

pub fn make_test_process() -> crate::model::process::Process {
    crate::model::process::Process::new(rand::thread_rng().gen::<[u8; 16]>())
}

pub fn make_test_process_from_number(n: u8) -> crate::model::process::Process {
    crate::model::process::Process::new([n; 16])
}

pub fn make_test_event_with_content(
    keypair: &::ed25519_dalek::SigningKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
    content_type: u64,
    content: &::std::vec::Vec<u8>,
    references: ::std::vec::Vec<crate::model::reference::Reference>,
) -> crate::model::signed_event::SignedEvent {
    let event = crate::model::event::Event::new(
        crate::model::public_key::PublicKey::Ed25519(keypair.verifying_key().clone()),
        process.clone(),
        logical_clock,
        content_type,
        content.clone(),
        crate::protocol::VectorClock::new(),
        crate::protocol::Indices::new(),
        references,
        None,
        None,
        None,
    );

    crate::model::signed_event::SignedEvent::sign(
        crate::model::event::to_proto(&event)
            .unwrap()
            .write_to_bytes()
            .unwrap(),
        &keypair,
    )
}

pub fn make_test_event(
    keypair: &::ed25519_dalek::SigningKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
) -> crate::model::signed_event::SignedEvent {
    let event = crate::model::event::Event::new(
        crate::model::public_key::PublicKey::Ed25519(keypair.verifying_key().clone()),
        process.clone(),
        logical_clock,
        3,
        vec![0, 1, 2, 3],
        crate::protocol::VectorClock::new(),
        crate::protocol::Indices::new(),
        vec![],
        None,
        None,
        None,
    );

    crate::model::signed_event::SignedEvent::sign(
        crate::model::event::to_proto(&event)
            .unwrap()
            .write_to_bytes()
            .unwrap(),
        &keypair,
    )
}

pub fn make_test_event_with_time(
    keypair: &::ed25519_dalek::SigningKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
    unix_milliseconds: u64,
) -> crate::model::signed_event::SignedEvent {
    let event = crate::model::event::Event::new(
        crate::model::public_key::PublicKey::Ed25519(keypair.verifying_key().clone()),
        process.clone(),
        logical_clock,
        crate::model::known_message_types::POST,
        vec![0, 1, 2, 3],
        crate::protocol::VectorClock::new(),
        crate::protocol::Indices::new(),
        vec![],
        None,
        None,
        Some(unix_milliseconds),
    );

    crate::model::signed_event::SignedEvent::sign(
        crate::model::event::to_proto(&event)
            .unwrap()
            .write_to_bytes()
            .unwrap(),
        &keypair,
    )
}

pub fn make_delete_event_from_event(
    keypair: &::ed25519_dalek::SigningKey,
    process: &crate::model::process::Process,
    subject_signed_event: &crate::model::signed_event::SignedEvent,
    logical_clock: u64,
    unix_milliseconds: u64,
) -> crate::model::signed_event::SignedEvent {
    let subject_event = crate::model::event::from_vec(subject_signed_event.event()).unwrap();

    let event = crate::model::event::Event::new(
        crate::model::public_key::PublicKey::Ed25519(keypair.verifying_key().clone()),
        process.clone(),
        logical_clock,
        crate::model::known_message_types::DELETE,
        crate::model::delete::to_proto(&crate::model::delete::Delete::new(
            subject_event.process().clone(),
            subject_event.logical_clock().clone(),
            subject_event.indices().clone(),
            *subject_event.unix_milliseconds(),
            *subject_event.content_type(),
        ))
        .write_to_bytes()
        .unwrap(),
        crate::protocol::VectorClock::new(),
        crate::protocol::Indices::new(),
        vec![],
        None,
        None,
        Some(unix_milliseconds),
    );

    crate::model::signed_event::SignedEvent::sign(
        crate::model::event::to_proto(&event)
            .unwrap()
            .write_to_bytes()
            .unwrap(),
        &keypair,
    )
}
