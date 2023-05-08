use ::anyhow::Context;
use ::protobuf::Message;

pub mod digest {
    #[derive(PartialEq, Clone, Debug)]
    pub enum Digest {
        SHA256([u8; 32]),
    }

    pub fn from_proto(
        proto: &crate::protocol::Digest,
    ) -> ::anyhow::Result<Digest> {
        match proto.digest_type {
            1 => Ok(Digest::SHA256(proto.digest.as_slice().try_into()?)),
            _ => ::anyhow::bail!("unknown digest_type"),
        }
    }

    pub fn get_digest_type(digest: &Digest) -> u64 {
        match digest {
            Digest::SHA256(_) => 1,
        }
    }

    pub fn get_digest_bytes(digest: &Digest) -> ::std::vec::Vec<u8> {
        match digest {
            Digest::SHA256(bytes) => bytes.to_vec().clone(),
        }
    }

    pub fn to_proto(digest: &Digest) -> crate::protocol::Digest {
        let mut result = crate::protocol::Digest::new();
        result.digest_type = get_digest_type(digest);
        result.digest = get_digest_bytes(digest);
        result
    }
}

pub mod pointer {
    #[derive(PartialEq, Clone, Debug)]
    pub struct Pointer {
        system: crate::model::public_key::PublicKey,
        process: crate::model::process::Process,
        logical_clock: u64,
        event_digest: crate::model::digest::Digest,
    }

    impl Pointer {
        pub fn new(
            system: crate::model::public_key::PublicKey,
            process: crate::model::process::Process,
            logical_clock: u64,
            event_digest: crate::model::digest::Digest,
        ) -> Pointer {
            Pointer {
                system: system,
                process: process,
                logical_clock: logical_clock,
                event_digest: event_digest,
            }
        }

        pub fn system(&self) -> &crate::model::public_key::PublicKey {
            &self.system
        }

        pub fn process(&self) -> &crate::model::process::Process {
            &self.process
        }

        pub fn logical_clock(&self) -> &u64 {
            &self.logical_clock
        }

        pub fn event_digest(&self) -> &crate::model::digest::Digest {
            &self.event_digest
        }
    }

    pub fn from_proto(
        proto: &crate::protocol::Pointer,
    ) -> ::anyhow::Result<Pointer> {
        Ok(Pointer::new(
            crate::model::public_key::from_proto(&proto.system)?,
            crate::model::process::from_proto(&proto.process)?,
            proto.logical_clock,
            crate::model::digest::from_proto(&proto.event_digest)?,
        ))
    }

    pub fn to_proto(pointer: &Pointer) -> crate::protocol::Pointer {
        let mut result = crate::protocol::Pointer::new();
        result.system = ::protobuf::MessageField::some(
            crate::model::public_key::to_proto(pointer.system()),
        );
        result.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(pointer.process()),
        );
        result.logical_clock = *pointer.logical_clock();
        result.event_digest = ::protobuf::MessageField::some(
            crate::model::digest::to_proto(pointer.event_digest()),
        );
        result
    }
}

pub mod public_key {
    use ::ed25519_dalek::Verifier;
    use ::protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub enum PublicKey {
        Ed25519(::ed25519_dalek::PublicKey),
    }

    pub fn get_key_type(public_key: &PublicKey) -> u64 {
        match public_key {
            PublicKey::Ed25519(_) => 1,
        }
    }

    pub fn get_key_bytes(public_key: &PublicKey) -> ::std::vec::Vec<u8> {
        match public_key {
            PublicKey::Ed25519(x) => x.to_bytes().to_vec().clone(),
        }
    }

    pub fn from_type_and_bytes(
        key_type: u64,
        key: &::std::vec::Vec<u8>,
    ) -> ::anyhow::Result<PublicKey> {
        match key_type {
            1 => Ok(PublicKey::Ed25519(
                ::ed25519_dalek::PublicKey::from_bytes(key)?,
            )),
            _ => {
                ::anyhow::bail!("unknown key_type");
            }
        }
    }

    pub fn validate_signature(
        public_key: &PublicKey,
        signature: &::std::vec::Vec<u8>,
        digest: &::std::vec::Vec<u8>,
    ) -> ::anyhow::Result<()> {
        match public_key {
            PublicKey::Ed25519(key) => {
                let signature =
                    ::ed25519_dalek::Signature::try_from(&signature[..])
                        .map_err(|e| ::anyhow::Error::new(e))?;

                key.verify(digest, &signature)
                    .map_err(|e| ::anyhow::Error::new(e))
            }
        }
    }

    pub fn from_proto(
        proto: &crate::protocol::PublicKey,
    ) -> ::anyhow::Result<PublicKey> {
        from_type_and_bytes(proto.key_type, &proto.key)
    }

    pub fn to_proto(public_key: &PublicKey) -> crate::protocol::PublicKey {
        let mut proto = crate::protocol::PublicKey::new();

        match public_key {
            PublicKey::Ed25519(key) => {
                proto.key_type = 1;
                proto.key = key.as_bytes().to_vec().clone();
            }
        }

        proto
    }

    pub fn serde_url_deserialize<'de, D>(
        deserializer: D,
    ) -> Result<PublicKey, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

        let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
            .map_err(::serde::de::Error::custom)?;

        let proto = crate::protocol::PublicKey::parse_from_tokio_bytes(
            &::bytes::Bytes::from(bytes),
        )
        .map_err(::serde::de::Error::custom)?;

        from_proto(&proto).map_err(::serde::de::Error::custom)
    }
}

pub mod process {
    use ::protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub struct Process {
        process: [u8; 16],
    }

    impl Process {
        pub fn new(process: [u8; 16]) -> Process {
            Process { process: process }
        }

        pub fn bytes(&self) -> &[u8; 16] {
            &self.process
        }
    }

    pub fn from_vec(bytes: &::std::vec::Vec<u8>) -> ::anyhow::Result<Process> {
        Ok(Process::new(bytes.as_slice().try_into()?))
    }

    pub fn from_proto(
        proto: &crate::protocol::Process,
    ) -> ::anyhow::Result<Process> {
        Ok(Process::new(proto.process.as_slice().try_into()?))
    }

    pub fn to_proto(process: &Process) -> crate::protocol::Process {
        let mut proto = crate::protocol::Process::new();
        proto.process = process.bytes().to_vec().clone();
        proto
    }

    pub fn serde_url_deserialize<'de, D>(
        deserializer: D,
    ) -> Result<Process, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

        let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
            .map_err(::serde::de::Error::custom)?;

        let proto = crate::protocol::Process::parse_from_tokio_bytes(
            &::bytes::Bytes::from(bytes),
        )
        .map_err(::serde::de::Error::custom)?;

        from_proto(&proto).map_err(::serde::de::Error::custom)
    }
}

pub fn serde_url_deserialize_repeated_uint64<'de, D>(
    deserializer: D,
) -> Result<crate::protocol::RepeatedUInt64, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    crate::protocol::RepeatedUInt64::parse_from_tokio_bytes(
        &::bytes::Bytes::from(bytes),
    )
    .map_err(::serde::de::Error::custom)
}

pub mod event {
    use ::anyhow::Context;
    use ::protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub struct Event {
        system: crate::model::public_key::PublicKey,
        process: crate::model::process::Process,
        logical_clock: u64,
        content_type: u64,
        content: ::std::vec::Vec<u8>,
        vector_clock: crate::protocol::VectorClock,
        indices: crate::protocol::Indices,
        references: ::std::vec::Vec<crate::model::reference::Reference>,
        lww_element: ::std::option::Option<crate::protocol::LWWElement>,
    }

    impl Event {
        pub fn new(
            system: crate::model::public_key::PublicKey,
            process: crate::model::process::Process,
            logical_clock: u64,
            content_type: u64,
            content: ::std::vec::Vec<u8>,
            vector_clock: crate::protocol::VectorClock,
            indices: crate::protocol::Indices,
            references: ::std::vec::Vec<crate::model::reference::Reference>,
            lww_element: ::std::option::Option<crate::protocol::LWWElement>,
        ) -> Event {
            Event {
                system: system,
                process: process,
                logical_clock: logical_clock,
                content_type: content_type,
                content: content,
                vector_clock: vector_clock,
                indices: indices,
                references: references,
                lww_element: lww_element,
            }
        }

        pub fn system(&self) -> &crate::model::public_key::PublicKey {
            &self.system
        }

        pub fn process(&self) -> &crate::model::process::Process {
            &self.process
        }

        pub fn logical_clock(&self) -> &u64 {
            &self.logical_clock
        }

        pub fn content_type(&self) -> &u64 {
            &self.content_type
        }

        pub fn content(&self) -> &::std::vec::Vec<u8> {
            &self.content
        }

        pub fn vector_clock(&self) -> &crate::protocol::VectorClock {
            &self.vector_clock
        }

        pub fn indices(&self) -> &crate::protocol::Indices {
            &self.indices
        }

        pub fn references(
            &self,
        ) -> &::std::vec::Vec<crate::model::reference::Reference> {
            &self.references
        }

        pub fn lww_element(
            &self,
        ) -> &::std::option::Option<crate::protocol::LWWElement> {
            &self.lww_element
        }
    }

    pub fn from_proto(
        proto: &crate::protocol::Event,
    ) -> ::anyhow::Result<Event> {
        Ok(Event::new(
            crate::model::public_key::from_proto(&proto.system)?,
            crate::model::process::from_proto(&proto.process)?,
            proto.logical_clock.clone(),
            proto.content_type.clone(),
            proto.content.clone(),
            proto
                .vector_clock
                .clone()
                .into_option()
                .context("expected vector_clock")?,
            proto
                .indices
                .clone()
                .into_option()
                .context("expected indices")?,
            proto
                .references
                .iter()
                .map(|x| crate::model::reference::from_proto(&x))
                .collect::<::anyhow::Result<
                    ::std::vec::Vec<crate::model::reference::Reference>,
                >>()?,
            proto.lww_element.clone().into_option(),
        ))
    }

    pub fn from_vec(
        vec: &::std::vec::Vec<u8>,
    ) -> ::anyhow::Result<Event> {
        from_proto(&crate::protocol::Event::parse_from_bytes(vec)?)
    }

    pub(crate) fn to_proto(
        event: &Event,
    ) -> ::anyhow::Result<crate::protocol::Event> {
        let mut result = crate::protocol::Event::new();

        result.system = ::protobuf::MessageField::some(
            crate::model::public_key::to_proto(event.system()),
        );
        result.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(event.process()),
        );
        result.logical_clock = event.logical_clock().clone();
        result.content_type = event.content_type().clone();
        result.content = event.content().clone();
        result.vector_clock =
            ::protobuf::MessageField::some(event.vector_clock().clone());
        result.indices =
            ::protobuf::MessageField::some(event.indices().clone());
        result.references = event.references().iter()
            .map(|x| crate::model::reference::to_proto(&x))
            .collect::<::anyhow::Result<
                ::std::vec::Vec<crate::protocol::Reference>
            >>()?;
        result.lww_element = ::protobuf::MessageField::from_option(
            event.lww_element().clone(),
        );

        Ok(result)
    }
}

pub mod signed_event {
    use ::anyhow::Context;
    use ::ed25519_dalek::Signer;
    use ::ed25519_dalek::Verifier;
    use ::protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub struct SignedEvent {
        event: ::std::vec::Vec<u8>,
        signature: ::std::vec::Vec<u8>,
    }

    impl SignedEvent {
        pub fn new(
            event: ::std::vec::Vec<u8>,
            signature: std::vec::Vec<u8>,
        ) -> ::anyhow::Result<SignedEvent> {
            let parsed = crate::model::event::from_proto(
                &crate::protocol::Event::parse_from_bytes(&event)?,
            )?;

            crate::model::public_key::validate_signature(
                parsed.system(),
                &signature,
                &event,
            )?;

            Ok(SignedEvent {
                event: event,
                signature: signature,
            })
        }

        pub fn sign(
            event: ::std::vec::Vec<u8>,
            keypair: &::ed25519_dalek::Keypair,
        ) -> SignedEvent {
            let signature = keypair.sign(&event);

            SignedEvent {
                event: event,
                signature: signature.to_bytes().to_vec(),
            }
        }

        pub fn event(&self) -> &::std::vec::Vec<u8> {
            &self.event
        }

        pub fn signature(&self) -> &::std::vec::Vec<u8> {
            &self.signature
        }
    }

    pub fn from_proto(
        proto: &crate::protocol::SignedEvent,
    ) -> ::anyhow::Result<SignedEvent> {
        Ok(SignedEvent::new(
            proto.event.clone(),
            proto.signature.clone(),
        )?)
    }

    pub(crate) fn to_proto(
        event: &SignedEvent,
    ) -> crate::protocol::SignedEvent {
        let mut result = crate::protocol::SignedEvent::new();
        result.event = event.event.clone();
        result.signature = event.signature.clone();
        result
    }
}

pub(crate) fn hash_event(event: &::std::vec::Vec<u8>) -> [u8; 32] {
    let mut hasher = ::hmac_sha256::Hash::new();
    hasher.update(event);
    hasher.finalize()
}

pub mod delete {
    use ::anyhow::Context;

    #[derive(PartialEq, Clone, Debug)]
    pub struct Delete {
        process: crate::model::process::Process,
        logical_clock: u64,
        indices: crate::protocol::Indices,
    }

    impl Delete {
        pub fn new(
            process: crate::model::process::Process,
            logical_clock: u64,
            indices: crate::protocol::Indices,
        ) -> Delete {
            Delete {
                process: process,
                logical_clock: logical_clock,
                indices: indices,
            }
        }

        pub fn process(&self) -> &crate::model::process::Process {
            &self.process
        }

        pub fn logical_clock(&self) -> &u64 {
            &self.logical_clock
        }

        pub fn indices(&self) -> &crate::protocol::Indices {
            &self.indices
        }
    }

    pub fn from_proto(
        proto: &crate::protocol::Delete,
    ) -> ::anyhow::Result<Delete> {
        Ok(Delete::new(
            crate::model::process::from_proto(&proto.process)?,
            proto.logical_clock,
            proto
                .indices
                .clone()
                .into_option()
                .context("expected indices")?,
        ))
    }

    pub fn to_proto(item: &Delete) -> crate::protocol::Delete {
        let mut result = crate::protocol::Delete::new();
        result.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(item.process()),
        );
        result.logical_clock = *item.logical_clock();
        result.indices = ::protobuf::MessageField::some(item.indices().clone());
        result
    }
}

pub mod reference {
    use ::protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub enum Reference {
        System(crate::model::public_key::PublicKey),
        Pointer(crate::model::pointer::Pointer),
        Bytes(::std::vec::Vec<u8>),
    }

    pub fn to_proto(
        reference: &Reference,
    ) -> ::anyhow::Result<crate::protocol::Reference> {
        let mut result = crate::protocol::Reference::new();

        match reference {
            Reference::System(system) => {
                result.reference_type = 1;
                result.reference = crate::model::public_key::to_proto(&system)
                    .write_to_bytes()
                    .map_err(|e| ::anyhow::Error::new(e))?;
            }
            Reference::Pointer(pointer) => {
                result.reference_type = 2;
                result.reference = crate::model::pointer::to_proto(&pointer)
                    .write_to_bytes()
                    .map_err(|e| ::anyhow::Error::new(e))?;
            }
            Reference::Bytes(bytes) => {
                result.reference_type = 3;
                result.reference = bytes.clone();
            }
        }

        Ok(result)
    }

    pub fn from_proto(
        reference: &crate::protocol::Reference,
    ) -> ::anyhow::Result<Reference> {
        match reference.reference_type {
            1 => {
                let proto = crate::protocol::PublicKey::parse_from_bytes(
                    &reference.reference,
                )
                .map_err(|e| ::anyhow::Error::new(e))?;

                Ok(Reference::System(crate::model::public_key::from_proto(
                    &proto,
                )?))
            }
            2 => {
                let proto = crate::protocol::Pointer::parse_from_bytes(
                    &reference.reference,
                )
                .map_err(|e| ::anyhow::Error::new(e))?;

                Ok(Reference::Pointer(crate::model::pointer::from_proto(
                    &proto,
                )?))
            }
            3 => {
                Ok(Reference::Bytes(reference.reference.clone()))
            }
            _ => ::anyhow::bail!("unknown_reference_type"),
        }
    }
}

pub mod claim {
    use ::protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub struct Claim {
        claim_type: ::std::string::String,
        claim: ::std::vec::Vec<u8>,
    }

    impl Claim {
        pub fn new(
            claim_type: &::std::string::String,
            claim: &::std::vec::Vec<u8>,
        ) -> Claim {
            Claim {
                claim_type: claim_type.clone(),
                claim: claim.clone(),
            }
        }

        pub fn claim_type(&self) -> &::std::string::String {
            &self.claim_type
        }

        pub fn claim(&self) -> &::std::vec::Vec<u8> {
            &self.claim
        }
    }

    pub fn to_proto(claim: &Claim) -> crate::protocol::Claim {
        let mut proto = crate::protocol::Claim::new();
        proto.claim_type = claim.claim_type().clone();
        proto.claim = claim.claim().clone();
        proto
    }

    pub fn from_proto(proto: &crate::protocol::Claim) -> Claim {
        Claim::new(&proto.claim_type, &proto.claim)
    }

    pub fn serde_url_deserialize<'de, D>(
        deserializer: D,
    ) -> Result<Claim, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

        let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
            .map_err(::serde::de::Error::custom)?;

        let proto = crate::protocol::Claim::parse_from_tokio_bytes(
            &::bytes::Bytes::from(bytes),
        )
        .map_err(::serde::de::Error::custom)?;

        Ok(from_proto(&proto))
    }
}

pub mod content {
    use ::protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub enum Content {
        Delete(crate::model::delete::Delete),
        Claim(crate::model::claim::Claim),
        Unknown(u64, ::std::vec::Vec<u8>),
    }

    pub fn decode_content(
        content_type: u64,
        content: &::std::vec::Vec<u8>,
    ) -> ::anyhow::Result<Content> {
        match content_type {
            1 => {
                let proto = crate::protocol::Delete::parse_from_bytes(content)
                    .map_err(|e| ::anyhow::Error::new(e))?;

                Ok(Content::Delete(crate::model::delete::from_proto(&proto)?))
            }
            12 => {
                let proto = crate::protocol::Claim::parse_from_bytes(content)
                    .map_err(|e| ::anyhow::Error::new(e))?;

                Ok(Content::Claim(crate::model::claim::from_proto(&proto)))
            }
            _ => Ok(Content::Unknown(content_type, content.clone())),
        }
    }

    pub fn content_type(content: &Content) -> u64 {
        match content {
            Content::Delete(_) => 1,
            Content::Claim(_) => 12,
            Content::Unknown(content_type, _) => content_type.clone(),
        }
    }

    pub fn encode_content(
        content: &Content,
    ) -> ::anyhow::Result<::std::vec::Vec<u8>> {
        match content {
            Content::Delete(body) => crate::model::delete::to_proto(body)
                .write_to_bytes()
                .map_err(|e| ::anyhow::Error::new(e)),
            Content::Claim(body) => crate::model::claim::to_proto(body)
                .write_to_bytes()
                .map_err(|e| ::anyhow::Error::new(e)),
            Content::Unknown(_, body) => Ok(body.clone()),
        }
    }
}

#[cfg(test)]
pub mod tests {
    use ::ed25519_dalek::Signer;
    use ::protobuf::Message;
    use ::rand::Rng;

    pub fn make_test_keypair() -> ::ed25519_dalek::Keypair {
        ::ed25519_dalek::Keypair::generate(&mut ::rand::thread_rng())
    }

    pub fn make_test_process() -> crate::model::process::Process {
        crate::model::process::Process::new(
            rand::thread_rng().gen::<[u8; 16]>(),
        )
    }

    pub fn make_test_event_with_content(
        keypair: &::ed25519_dalek::Keypair,
        process: &crate::model::process::Process,
        logical_clock: u64,
        content_type: u64,
        content: &::std::vec::Vec<u8>,
        references: ::std::vec::Vec<crate::model::reference::Reference>,
    ) -> crate::model::signed_event::SignedEvent {
        let system = crate::model::public_key::PublicKey::Ed25519(
            keypair.public.clone(),
        );

        let vector_clock = crate::protocol::VectorClock::new();
        let indices = crate::protocol::Indices::new();

        let event = crate::model::event::Event::new(
            system,
            process.clone(),
            logical_clock,
            content_type,
            content.clone(),
            vector_clock,
            indices,
            references,
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
        keypair: &::ed25519_dalek::Keypair,
        process: &crate::model::process::Process,
        logical_clock: u64,
    ) -> crate::model::signed_event::SignedEvent {
        let system = crate::model::public_key::PublicKey::Ed25519(
            keypair.public.clone(),
        );

        let vector_clock = crate::protocol::VectorClock::new();
        let indices = crate::protocol::Indices::new();

        let event = crate::model::event::Event::new(
            system,
            process.clone(),
            logical_clock,
            3,
            vec![0, 1, 2, 3],
            vector_clock,
            indices,
            vec![],
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

    #[test]
    fn signed_event_to_from_protobuf_event_is_isomorphic() {
        let identity_keypair = make_test_keypair();

        let process = make_test_process();

        let signed_event = make_test_event(&identity_keypair, &process, 52);

        let protobuf_event =
            crate::model::signed_event::to_proto(&signed_event);

        let parsed_event =
            crate::model::signed_event::from_proto(&protobuf_event).unwrap();

        assert!(signed_event == parsed_event);
    }
}
