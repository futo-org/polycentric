use ::anyhow::Context;

#[derive(PartialEq, Clone, Debug)]
pub struct WriterId(pub [u8; 32]);

pub fn vec_to_writer_id(
    vec: &::std::vec::Vec<u8>,
) -> ::anyhow::Result<WriterId> {
    Ok(WriterId(vec.as_slice().try_into()?))
}

pub mod pointer {
    #[derive(PartialEq, Clone, Debug)]
    pub struct Pointer {
        identity: ::ed25519_dalek::PublicKey,
        writer: crate::model::WriterId,
        sequence_number: u64,
    }

    impl Pointer {
        pub fn new(
            identity: ::ed25519_dalek::PublicKey,
            writer: crate::model::WriterId,
            sequence_number: u64,
        ) -> Pointer {
            Pointer {
                identity: identity,
                writer: writer,
                sequence_number: sequence_number,
            }
        }

        pub fn identity(&self) -> &::ed25519_dalek::PublicKey {
            &self.identity
        }

        pub fn writer(&self) -> &crate::model::WriterId {
            &self.writer
        }

        pub fn sequence_number(&self) -> u64 {
            self.sequence_number
        }
    }
}

pub mod event {
    #[derive(PartialEq, Clone, Debug)]
    pub struct Clock {
        writer: crate::model::WriterId,
        value: u64,
    }

    impl Clock {
        pub fn new(writer: crate::model::WriterId, value: u64) -> Clock {
            Clock {
                writer: writer,
                value: value,
            }
        }

        pub fn writer(&self) -> &crate::model::WriterId {
            &self.writer
        }

        pub fn value(&self) -> u64 {
            self.value
        }
    }

    #[derive(PartialEq, Clone, Debug)]
    pub struct Event {
        identity: ::ed25519_dalek::PublicKey,
        writer: crate::model::WriterId,
        sequence_number: u64,
        unix_milliseconds: u64,
        content: ::std::vec::Vec<u8>,
        clocks: ::std::vec::Vec<Clock>,
    }

    impl Event {
        pub fn new(
            identity: ::ed25519_dalek::PublicKey,
            writer: crate::model::WriterId,
            sequence_number: u64,
            unix_milliseconds: u64,
            content: ::std::vec::Vec<u8>,
            clocks: ::std::vec::Vec<Clock>,
        ) -> Event {
            Event {
                identity: identity,
                writer: writer,
                sequence_number: sequence_number,
                unix_milliseconds: unix_milliseconds,
                content: content,
                clocks: clocks,
            }
        }

        pub fn identity(&self) -> &::ed25519_dalek::PublicKey {
            &self.identity
        }

        pub fn writer(&self) -> &crate::model::WriterId {
            &self.writer
        }

        pub fn sequence_number(&self) -> u64 {
            self.sequence_number
        }

        pub fn unix_milliseconds(&self) -> u64 {
            self.unix_milliseconds
        }

        pub fn content(&self) -> &::std::vec::Vec<u8> {
            &self.content
        }

        pub fn clocks(&self) -> &::std::vec::Vec<Clock> {
            &self.clocks
        }
    }
}

pub mod signed_event {
    use ::ed25519_dalek::Signer;
    use ::ed25519_dalek::Verifier;

    #[derive(PartialEq, Clone, Debug)]
    pub struct SignedEvent {
        event: crate::model::event::Event,
        signature: ::ed25519_dalek::Signature,
    }

    impl SignedEvent {
        pub fn new(
            event: crate::model::event::Event,
            signature: ::ed25519_dalek::Signature,
        ) -> ::anyhow::Result<SignedEvent> {
            let digest = crate::model::hash_event(&event);

            event.identity().verify(&digest, &signature)?;

            Ok(SignedEvent {
                event: event,
                signature: signature,
            })
        }

        pub fn sign(
            event: crate::model::event::Event,
            keypair: &::ed25519_dalek::Keypair,
        ) -> SignedEvent {
            let digest = crate::model::hash_event(&event);

            let signature = keypair.sign(&digest);

            SignedEvent {
                event: event,
                signature,
            }
        }

        pub fn event(&self) -> &crate::model::event::Event {
            &self.event
        }

        pub fn signature(&self) -> &::ed25519_dalek::Signature {
            &self.signature
        }
    }
}

pub(crate) fn hash_event(event: &event::Event) -> [u8; 32] {
    let mut hasher = ::hmac_sha256::Hash::new();

    hasher.update(&event.writer().0);
    hasher.update(&event.identity().to_bytes());
    hasher.update(&event.sequence_number().to_le_bytes());
    hasher.update(&event.unix_milliseconds().to_le_bytes());
    hasher.update(&event.content());

    for clock in event.clocks() {
        hasher.update(&clock.writer().0);
        hasher.update(&clock.value().to_le_bytes());
    }

    hasher.finalize()
}

pub(crate) fn protobuf_event_to_signed_event(
    protobuf_event: &crate::protocol::Event,
) -> ::anyhow::Result<signed_event::SignedEvent> {
    let identity = ::ed25519_dalek::PublicKey::from_bytes(
        &protobuf_event.author_public_key,
    )?;

    let writer = vec_to_writer_id(&protobuf_event.writer_id)?;

    let clocks = protobuf_event
        .clocks
        .iter()
        .map(|clock| {
            Ok(event::Clock::new(
                vec_to_writer_id(&clock.key)?,
                clock.value,
            ))
        })
        .collect::<::anyhow::Result<::std::vec::Vec<event::Clock>>>()?;

    let event = event::Event::new(
        identity,
        writer,
        protobuf_event.sequence_number,
        protobuf_event.unix_milliseconds,
        protobuf_event.content.clone(),
        clocks,
    );

    let raw_signature = protobuf_event
        .signature
        .clone()
        .context("expected signature")?;

    let signature = ed25519_dalek::Signature::try_from(&raw_signature[..])?;

    signed_event::SignedEvent::new(event, signature)
}

pub(crate) fn signed_event_to_protobuf_event(
    signed_event: &signed_event::SignedEvent,
) -> crate::protocol::Event {
    let mut result = crate::protocol::Event::new();

    let event = signed_event.event();

    result.author_public_key = event.identity().to_bytes().to_vec().clone();
    result.writer_id = event.writer().0.to_vec().clone();
    result.sequence_number = event.sequence_number();
    result.unix_milliseconds = event.unix_milliseconds();
    result.content = event.content().clone();
    result.signature =
        Some(signed_event.signature().to_bytes().to_vec().clone());

    result.clocks = event
        .clocks()
        .iter()
        .map(|clock| {
            let mut result = crate::protocol::EventClockEntry::new();

            result.key = clock.writer().0.to_vec().clone();
            result.value = clock.value();

            result
        })
        .collect();

    result
}

#[cfg(test)]
pub mod tests {
    #[test]
    fn signed_event_to_from_protobuf_event_is_isomorphic() {
        let identity_keypair = crate::crypto::tests::make_test_keypair();
        let writer_keypair = crate::crypto::tests::make_test_keypair();
        let other_writer_keypair = crate::crypto::tests::make_test_keypair();

        let event = crate::model::event::Event::new(
            identity_keypair.public.clone(),
            crate::model::WriterId(writer_keypair.public.to_bytes().clone()),
            5,
            100,
            vec![0, 1, 2, 3],
            vec![
                crate::model::event::Clock::new(
                    crate::model::WriterId(
                        writer_keypair.public.to_bytes().clone(),
                    ),
                    5,
                ),
                crate::model::event::Clock::new(
                    crate::model::WriterId(
                        other_writer_keypair.public.to_bytes().clone(),
                    ),
                    12,
                ),
            ],
        );

        let signed_event = crate::model::signed_event::SignedEvent::sign(
            event,
            &identity_keypair,
        );

        let protobuf_event =
            crate::model::signed_event_to_protobuf_event(&signed_event);

        let parsed_event =
            crate::model::protobuf_event_to_signed_event(&protobuf_event)
                .unwrap();

        assert!(signed_event == parsed_event);
    }
}
