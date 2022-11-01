use ::ed25519_dalek::Verifier;

pub fn hash_event(event: &crate::protocol::Event) -> [u8; 32] {
    let mut hasher = ::hmac_sha256::Hash::new();
    hasher.update(&event.writer_id);
    hasher.update(&event.author_public_key);
    hasher.update(&event.sequence_number.to_le_bytes());
    hasher.update(&event.unix_milliseconds.to_le_bytes());
    hasher.update(&event.content);

    for clock in &event.clocks {
        hasher.update(&clock.key);
        hasher.update(&clock.value.to_le_bytes());
    }

    hasher.finalize()
}

pub fn validate_signature(event: &crate::protocol::Event) -> bool {
    let public_key = match ::ed25519_dalek::PublicKey::from_bytes(
        &event.author_public_key,
    ) {
        Ok(key) => key,
        Err(_) => return false,
    };

    let signature = match &event.signature {
        None => return false,
        Some(raw_signature) => {
            match ::ed25519_dalek::Signature::try_from(&raw_signature[..]) {
                Ok(validated) => validated,
                Err(_) => return false,
            }
        }
    };

    let hash = hash_event(event);

    public_key.verify(&hash, &signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ::ed25519_dalek::Signer;
    use ::protobuf::Message;
    use ::rand::Rng;

    pub fn add_signature(
        event: &mut crate::protocol::Event,
        keypair: &::ed25519_dalek::Keypair,
    ) {
        let hash = hash_event(&event);
        let signature = keypair.sign(&hash);
        event.signature = Some(signature.to_bytes().to_vec());
    }

    fn make_test_keypair() -> ::ed25519_dalek::Keypair {
        ::ed25519_dalek::Keypair::generate(&mut ::rand::thread_rng())
    }

    fn make_test_event(
        keypair: &::ed25519_dalek::Keypair,
    ) -> crate::protocol::Event {
        let writer_id = ::rand::thread_rng().gen::<[u8; 32]>().to_vec();

        let event_body_message = crate::protocol::EventBodyMessage::new();
        let mut event_body = crate::protocol::EventBody::new();

        event_body.set_message(event_body_message);

        let event_body_serialized = event_body.write_to_bytes().unwrap();

        let mut event = crate::protocol::Event::new();
        event.content = event_body_serialized;
        event.writer_id = writer_id.clone();
        event.author_public_key = keypair.public.to_bytes().to_vec().clone();
        event.sequence_number = 52;
        event.unix_milliseconds = 33;

        event
    }

    #[test]
    fn validate_signature_correct() {
        let keypair = make_test_keypair();
        let mut event = make_test_event(&keypair);
        add_signature(&mut event, &keypair);
        assert!(validate_signature(&event));
    }

    #[test]
    fn validate_signature_fails_if_unsigned() {
        let keypair = make_test_keypair();
        let event = make_test_event(&keypair);
        assert!(!validate_signature(&event));
    }

    #[test]
    fn validate_signature_fails_if_mutated_writer_id() {
        let keypair = make_test_keypair();
        let mut event = make_test_event(&keypair);
        event.writer_id[0] += 1;
        assert!(!validate_signature(&event));
    }

    #[test]
    fn validate_signature_fails_if_mutated_public_key() {
        let keypair = make_test_keypair();
        let mut event = make_test_event(&keypair);
        event.author_public_key[0] += 1;
        assert!(!validate_signature(&event));
    }

    #[test]
    fn validate_signature_fails_if_mutated_sequence_number() {
        let keypair = make_test_keypair();
        let mut event = make_test_event(&keypair);
        event.sequence_number += 1;
        assert!(!validate_signature(&event));
    }

    #[test]
    fn validate_signature_fails_if_mutated_content() {
        let keypair = make_test_keypair();
        let mut event = make_test_event(&keypair);
        event.content[0] += 1;
        assert!(!validate_signature(&event));
    }

    #[test]
    fn validate_signature_fails_if_mutated_unix_milliseconds() {
        let keypair = make_test_keypair();
        let mut event = make_test_event(&keypair);
        event.unix_milliseconds += 1;
        assert!(!validate_signature(&event));
    }
}
