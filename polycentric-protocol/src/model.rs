#![allow(dead_code)]

use ::protobuf::Message;

pub mod known_message_types {
    pub const DELETE: u64 = 1;
    pub const SYSTEM_PROCESSES: u64 = 2;
    pub const POST: u64 = 3;
    pub const FOLLOW: u64 = 4;
    pub const USERNAME: u64 = 5;
    pub const DESCRIPTION: u64 = 6;
    pub const BLOB_META: u64 = 7;
    pub const BLOB_SECTION: u64 = 8;
    pub const AVATAR: u64 = 9;
    pub const SERVER: u64 = 10;
    pub const VOUCH: u64 = 11;
    pub const CLAIM: u64 = 12;
    pub const BANNER: u64 = 13;
    pub const OPINION: u64 = 14;
    pub const STORE: u64 = 15;
    pub const AUTHORITY: u64 = 16;
    pub const JOIN_TOPIC: u64 = 17;
}

pub fn content_type_to_string(content_type: u64) -> String {
    match content_type {
        known_message_types::DELETE => "DELETE".to_string(),
        known_message_types::SYSTEM_PROCESSES => "SYSTEM_PROCESSES".to_string(),
        known_message_types::POST => "POST".to_string(),
        known_message_types::FOLLOW => "FOLLOW".to_string(),
        known_message_types::USERNAME => "USERNAME".to_string(),
        known_message_types::DESCRIPTION => "DESCRIPTION".to_string(),
        known_message_types::BLOB_META => "BLOB_META".to_string(),
        known_message_types::BLOB_SECTION => "BLOB_SECTION".to_string(),
        known_message_types::AVATAR => "AVATAR".to_string(),
        known_message_types::SERVER => "SERVER".to_string(),
        known_message_types::VOUCH => "VOUCH".to_string(),
        known_message_types::CLAIM => "CLAIM".to_string(),
        known_message_types::BANNER => "BANNER".to_string(),
        known_message_types::OPINION => "OPINION".to_string(),
        known_message_types::STORE => "STORE".to_string(),
        known_message_types::AUTHORITY => "AUTHORITY".to_string(),
        known_message_types::JOIN_TOPIC => "JOIN_TOPIC".to_string(),
        _ => content_type.to_string(),
    }
}

pub mod digest {
    #[derive(Hash, Eq, PartialEq, Clone, Debug)]
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
            Digest::SHA256(bytes) => bytes.to_vec(),
        }
    }

    pub fn to_proto(digest: &Digest) -> crate::protocol::Digest {
        let mut result = crate::protocol::Digest::new();
        result.digest_type = get_digest_type(digest);
        result.digest = get_digest_bytes(digest);
        result
    }

    pub fn compute(bytes: &::std::vec::Vec<u8>) -> Digest {
        let mut hasher = ::hmac_sha256::Hash::new();
        hasher.update(bytes);
        Digest::SHA256(hasher.finalize())
    }
}

#[derive(Hash, Eq, PartialEq, Clone, Debug)]
pub struct InsecurePointer {
    system: crate::model::public_key::PublicKey,
    process: crate::model::process::Process,
    logical_clock: u64,
}

impl InsecurePointer {
    pub fn new(
        system: crate::model::public_key::PublicKey,
        process: crate::model::process::Process,
        logical_clock: u64,
    ) -> InsecurePointer {
        InsecurePointer {
            system,
            process,
            logical_clock,
        }
    }

    pub fn from_event(event: &crate::model::event::Event) -> InsecurePointer {
        InsecurePointer::new(
            event.system().clone(),
            event.process().clone(),
            *event.logical_clock(),
        )
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
}

pub mod pointer {
    use protobuf::Message;

    #[derive(Hash, Eq, PartialEq, Clone, Debug)]
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
                system,
                process,
                logical_clock,
                event_digest,
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

    pub fn from_signed_event(
        signed_event: &crate::model::signed_event::SignedEvent,
    ) -> ::anyhow::Result<Pointer> {
        let event = crate::model::event::from_vec(signed_event.event())?;
        Ok(Pointer::new(
            event.system().clone(),
            event.process().clone(),
            *event.logical_clock(),
            crate::model::digest::compute(signed_event.event()),
        ))
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

    pub fn from_base64(string: &String) -> ::anyhow::Result<Pointer> {
        let bytes = base64::decode(string)?;
        let protocol_ptr = crate::protocol::Pointer::parse_from_bytes(&bytes)?;
        from_proto(&protocol_ptr)
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

    pub fn to_base64(pointer: &Pointer) -> ::anyhow::Result<String> {
        let protocol_ptr = to_proto(pointer);
        let mut bytes = vec![];
        protocol_ptr.write_to_vec(&mut bytes)?;
        Ok(::base64::encode(bytes))
    }
}

pub mod public_key {
    use ed25519_dalek::Verifier;
    use protobuf::Message;

    #[derive(Hash, Eq, PartialEq, Clone, Debug)]
    pub enum PublicKey {
        Ed25519(::ed25519_dalek::VerifyingKey),
    }

    pub fn get_key_type(public_key: &PublicKey) -> u64 {
        match public_key {
            PublicKey::Ed25519(_) => 1,
        }
    }

    pub fn get_key_bytes(public_key: &PublicKey) -> ::std::vec::Vec<u8> {
        match public_key {
            PublicKey::Ed25519(x) => x.to_bytes().to_vec(),
        }
    }

    pub fn from_type_and_bytes(
        key_type: u64,
        key: &[u8],
    ) -> ::anyhow::Result<PublicKey> {
        match key_type {
            1 => Ok(PublicKey::Ed25519(
                ::ed25519_dalek::VerifyingKey::from_bytes(key.try_into()?)?,
            )),
            _ => {
                ::anyhow::bail!("unknown key_type");
            }
        }
    }

    pub fn validate_signature(
        public_key: &PublicKey,
        signature: &[u8],
        digest: &[u8],
    ) -> ::anyhow::Result<()> {
        match public_key {
            PublicKey::Ed25519(key) => {
                let signature = ::ed25519_dalek::Signature::try_from(signature)
                    .map_err(::anyhow::Error::new)?;

                key.verify(digest, &signature).map_err(::anyhow::Error::new)
            }
        }
    }

    pub fn from_proto(
        proto: &crate::protocol::PublicKey,
    ) -> ::anyhow::Result<PublicKey> {
        from_type_and_bytes(proto.key_type, &proto.key)
    }

    pub fn from_url_proto(
        proto: &crate::protocol::URLInfoSystemLink,
    ) -> ::anyhow::Result<PublicKey> {
        from_proto(&proto.system)
    }

    pub fn to_proto(public_key: &PublicKey) -> crate::protocol::PublicKey {
        let mut proto = crate::protocol::PublicKey::new();

        match public_key {
            PublicKey::Ed25519(key) => {
                proto.key_type = 1;
                proto.key = key.as_bytes().to_vec();
            }
        }

        proto
    }

    pub fn to_base64(key: &PublicKey) -> ::anyhow::Result<String> {
        let protocol_ptr = to_proto(key);
        let mut bytes = vec![];
        protocol_ptr.write_to_vec(&mut bytes)?;
        Ok(base64::encode(bytes))
    }

    pub fn from_base64(string: &String) -> ::anyhow::Result<PublicKey> {
        let bytes = base64::decode(string)?;
        let protocol_obj =
            crate::protocol::PublicKey::parse_from_bytes(&bytes)?;
        let pub_key = from_proto(&protocol_obj)?;
        Ok(pub_key)
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
    use protobuf::Message;

    #[derive(Hash, Eq, PartialEq, Clone, Debug)]
    pub struct Process {
        process: [u8; 16],
    }

    impl Process {
        pub fn new(process: [u8; 16]) -> Process {
            Process { process }
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
        proto.process = process.bytes().to_vec();
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

#[derive(Clone, PartialEq)]
pub struct EventLayers {
    raw_event: ::std::vec::Vec<u8>,
    signed_event: crate::model::signed_event::SignedEvent,
    event: crate::model::event::Event,
    content: crate::model::content::Content,
}

impl EventLayers {
    pub fn new(
        signed_event: crate::model::signed_event::SignedEvent,
    ) -> ::anyhow::Result<EventLayers> {
        let raw_event = crate::model::signed_event::to_proto(&signed_event)
            .write_to_bytes()?;

        let event = crate::model::event::from_proto(
            &crate::protocol::Event::parse_from_bytes(signed_event.event())?,
        )?;

        let content = crate::model::content::decode_content(
            *event.content_type(),
            event.content(),
        )?;

        Ok(EventLayers {
            raw_event,
            signed_event,
            event,
            content,
        })
    }

    pub fn raw_event(&self) -> &::std::vec::Vec<u8> {
        &self.raw_event
    }

    pub fn signed_event(&self) -> &crate::model::signed_event::SignedEvent {
        &self.signed_event
    }

    pub fn event(&self) -> &crate::model::event::Event {
        &self.event
    }

    pub fn content(&self) -> &crate::model::content::Content {
        &self.content
    }
}

pub mod event {
    use anyhow::Context;
    use protobuf::Message;

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
        lww_element_set: ::std::option::Option<crate::protocol::LWWElementSet>,
        unix_milliseconds: ::std::option::Option<u64>,
    }

    #[allow(clippy::too_many_arguments)]
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
            lww_element_set: ::std::option::Option<
                crate::protocol::LWWElementSet,
            >,
            unix_milliseconds: ::std::option::Option<u64>,
        ) -> Event {
            Event {
                system,
                process,
                logical_clock,
                content_type,
                content,
                vector_clock,
                indices,
                references,
                lww_element,
                lww_element_set,
                unix_milliseconds,
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

        pub fn lww_element_set(
            &self,
        ) -> &::std::option::Option<crate::protocol::LWWElementSet> {
            &self.lww_element_set
        }

        pub fn unix_milliseconds(&self) -> &::std::option::Option<u64> {
            &self.unix_milliseconds
        }
    }

    pub fn from_proto(
        proto: &crate::protocol::Event,
    ) -> ::anyhow::Result<Event> {
        Ok(Event::new(
            crate::model::public_key::from_proto(&proto.system)?,
            crate::model::process::from_proto(&proto.process)?,
            proto.logical_clock,
            proto.content_type,
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
                .map(crate::model::reference::from_proto)
                .collect::<::anyhow::Result<
                    ::std::vec::Vec<crate::model::reference::Reference>,
                >>()?,
            proto.lww_element.clone().into_option(),
            proto.lww_element_set.clone().into_option(),
            proto.unix_milliseconds,
        ))
    }

    pub fn from_vec(vec: &[u8]) -> ::anyhow::Result<Event> {
        from_proto(&crate::protocol::Event::parse_from_bytes(vec)?)
    }

    pub fn to_proto(event: &Event) -> ::anyhow::Result<crate::protocol::Event> {
        let mut result = crate::protocol::Event::new();

        result.system = ::protobuf::MessageField::some(
            crate::model::public_key::to_proto(event.system()),
        );
        result.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(event.process()),
        );
        result.logical_clock = *event.logical_clock();
        result.content_type = *event.content_type();
        result.content = event.content().clone();
        result.vector_clock =
            ::protobuf::MessageField::some(event.vector_clock().clone());
        result.indices =
            ::protobuf::MessageField::some(event.indices().clone());
        result.references = event
            .references()
            .iter()
            .map(crate::model::reference::to_proto)
            .collect::<::anyhow::Result<::std::vec::Vec<crate::protocol::Reference>>>()?;
        result.lww_element =
            ::protobuf::MessageField::from_option(event.lww_element().clone());
        result.lww_element_set = ::protobuf::MessageField::from_option(
            event.lww_element_set().clone(),
        );
        result.unix_milliseconds = *event.unix_milliseconds();

        Ok(result)
    }
}

pub mod moderation_tag {
    #[cfg(feature = "sqlx")]
    use sqlx::{postgres::PgTypeInfo, Postgres, Type};

    // This is added so sqlx infers the type as a varchar and not a string
    #[derive(
        Debug, Clone, PartialEq, Eq, ::serde::Deserialize, ::serde::Serialize,
    )]
    pub struct ModerationTagName(String);

    impl ModerationTagName {
        pub fn new(tag: String) -> ModerationTagName {
            ModerationTagName(tag)
        }
    }

    // In order for sqlx to correctly infer the type as a varchar(N) and not a string
    #[cfg(feature = "sqlx")]
    impl Type<Postgres> for ModerationTagName {
        #[inline]
        fn type_info() -> <Postgres as sqlx::Database>::TypeInfo {
            PgTypeInfo::with_name("VARCHAR")
        }
    }

    #[cfg(feature = "sqlx")]
    impl<'r> sqlx::Decode<'r, Postgres> for ModerationTagName {
        fn decode(
            value: sqlx::postgres::PgValueRef<'r>,
        ) -> Result<Self, sqlx::error::BoxDynError> {
            let s = <&str as sqlx::Decode<Postgres>>::decode(value)?;
            Ok(ModerationTagName(s.to_string()))
        }
    }

    #[cfg(feature = "sqlx")]
    impl sqlx::Encode<'_, Postgres> for ModerationTagName {
        fn encode_by_ref(
            &self,
            buf: &mut sqlx::postgres::PgArgumentBuffer,
        ) -> sqlx::encode::IsNull {
            <&str as sqlx::Encode<Postgres>>::encode(&self.0.as_str(), buf)
        }

        fn size_hint(&self) -> usize {
            self.0.len() + 4
        }
    }

    impl From<ModerationTagName> for String {
        fn from(tag_name: ModerationTagName) -> Self {
            tag_name.0
        }
    }

    impl ToString for ModerationTagName {
        fn to_string(&self) -> String {
            self.0.clone()
        }
    }

    #[cfg(feature = "sqlx")]
    #[derive(
        PartialEq,
        Debug,
        ::sqlx::FromRow,
        ::sqlx::Type,
        ::serde::Deserialize,
        ::serde::Serialize,
        Clone,
    )]
    #[sqlx(type_name = "moderation_tag_type")]
    pub struct ModerationTag {
        tag: ModerationTagName,
        level: i16,
    }

    #[cfg(not(feature = "sqlx"))]
    #[derive(
        PartialEq, Debug, ::serde::Deserialize, ::serde::Serialize, Clone,
    )]
    pub struct ModerationTag {
        tag: ModerationTagName,
        level: i16,
    }

    impl ModerationTag {
        pub fn new(tag: String, level: i16) -> ModerationTag {
            ModerationTag {
                tag: ModerationTagName(tag),
                level,
            }
        }

        pub fn tag(&self) -> &ModerationTagName {
            &self.tag
        }

        pub fn level(&self) -> &i16 {
            &self.level
        }
    }

    #[cfg(feature = "sqlx")]
    impl sqlx::postgres::PgHasArrayType for ModerationTag {
        fn array_type_info() -> sqlx::postgres::PgTypeInfo {
            sqlx::postgres::PgTypeInfo::with_name("_moderation_tag_type")
        }
    }

    pub fn from_proto(proto: &crate::protocol::ModerationTag) -> ModerationTag {
        ModerationTag::new(proto.tag.clone(), proto.level as i16)
    }

    pub fn to_proto(tag: &ModerationTag) -> crate::protocol::ModerationTag {
        let mut proto = crate::protocol::ModerationTag::new();
        proto.tag = tag.tag().clone().into();
        proto.level = tag.level as u32;
        proto
    }
}

pub mod signed_event {
    use ed25519_dalek::Signer;
    use protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub struct SignedEvent {
        event: ::std::vec::Vec<u8>,
        signature: ::std::vec::Vec<u8>,
        moderation_tags:
            ::std::vec::Vec<crate::model::moderation_tag::ModerationTag>,
    }

    impl SignedEvent {
        pub fn new(
            event: ::std::vec::Vec<u8>,
            signature: std::vec::Vec<u8>,
            moderation_tags: ::std::vec::Vec<
                crate::model::moderation_tag::ModerationTag,
            >,
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
                event,
                signature,
                moderation_tags,
            })
        }

        pub fn sign(
            event: ::std::vec::Vec<u8>,
            keypair: &::ed25519_dalek::SigningKey,
        ) -> SignedEvent {
            let signature = keypair.sign(&event);

            SignedEvent {
                event,
                signature: signature.to_bytes().to_vec(),
                moderation_tags: ::std::vec::Vec::new(),
            }
        }

        pub fn event(&self) -> &::std::vec::Vec<u8> {
            &self.event
        }

        pub fn signature(&self) -> &::std::vec::Vec<u8> {
            &self.signature
        }

        pub fn moderation_tags(
            &self,
        ) -> &::std::vec::Vec<crate::model::moderation_tag::ModerationTag>
        {
            &self.moderation_tags
        }

        pub fn set_moderation_tags(
            &mut self,
            moderation_tags: ::std::vec::Vec<
                crate::model::moderation_tag::ModerationTag,
            >,
        ) {
            self.moderation_tags = moderation_tags;
        }
    }

    pub fn from_proto(
        proto: &crate::protocol::SignedEvent,
    ) -> ::anyhow::Result<SignedEvent> {
        SignedEvent::new(
            proto.event.clone(),
            proto.signature.clone(),
            proto
                .moderation_tags
                .iter()
                .map(|tag: &crate::protocol::ModerationTag| {
                    crate::model::moderation_tag::from_proto(tag)
                })
                .collect(),
        )
    }

    pub fn from_raw_event_with_moderation_tags(
        raw: &[u8],
        moderation_tags: &[crate::model::moderation_tag::ModerationTag],
    ) -> ::anyhow::Result<SignedEvent> {
        let mut signed_event = crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(raw)?,
        )?;

        signed_event.set_moderation_tags(moderation_tags.to_vec().clone());

        Ok(signed_event)
    }

    pub fn from_vec(vec: &[u8]) -> ::anyhow::Result<SignedEvent> {
        from_proto(&crate::protocol::SignedEvent::parse_from_bytes(vec)?)
    }

    pub fn to_proto(event: &SignedEvent) -> crate::protocol::SignedEvent {
        let mut result = crate::protocol::SignedEvent::new();
        result.event = event.event.clone();
        result.signature = event.signature.clone();
        result.moderation_tags = event
            .moderation_tags
            .iter()
            .map(crate::model::moderation_tag::to_proto)
            .collect::<::std::vec::Vec<crate::protocol::ModerationTag>>();

        result
    }
}

pub mod delete {
    use anyhow::Context;

    #[derive(PartialEq, Clone, Debug)]
    pub struct Delete {
        process: crate::model::process::Process,
        logical_clock: u64,
        indices: crate::protocol::Indices,
        unix_milliseconds: ::std::option::Option<u64>,
        content_type: u64,
    }

    impl Delete {
        pub fn new(
            process: crate::model::process::Process,
            logical_clock: u64,
            indices: crate::protocol::Indices,
            unix_milliseconds: ::std::option::Option<u64>,
            content_type: u64,
        ) -> Delete {
            Delete {
                process,
                logical_clock,
                indices,
                unix_milliseconds,
                content_type,
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

        pub fn unix_milliseconds(&self) -> &::std::option::Option<u64> {
            &self.unix_milliseconds
        }

        pub fn content_type(&self) -> &u64 {
            &self.content_type
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
            proto.unix_milliseconds,
            proto.content_type,
        ))
    }

    pub fn to_proto(item: &Delete) -> crate::protocol::Delete {
        let mut result = crate::protocol::Delete::new();
        result.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(item.process()),
        );
        result.logical_clock = *item.logical_clock();
        result.indices = ::protobuf::MessageField::some(item.indices().clone());
        result.unix_milliseconds = *item.unix_milliseconds();
        result.content_type = *item.content_type();
        result
    }
}

pub mod reference {
    use protobuf::Message;

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
                result.reference = crate::model::public_key::to_proto(system)
                    .write_to_bytes()
                    .map_err(::anyhow::Error::new)?;
            }
            Reference::Pointer(pointer) => {
                result.reference_type = 2;
                result.reference = crate::model::pointer::to_proto(pointer)
                    .write_to_bytes()
                    .map_err(::anyhow::Error::new)?;
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
                .map_err(::anyhow::Error::new)?;

                Ok(Reference::System(crate::model::public_key::from_proto(
                    &proto,
                )?))
            }
            2 => {
                let proto = crate::protocol::Pointer::parse_from_bytes(
                    &reference.reference,
                )
                .map_err(::anyhow::Error::new)?;

                Ok(Reference::Pointer(crate::model::pointer::from_proto(
                    &proto,
                )?))
            }
            3 => Ok(Reference::Bytes(reference.reference.clone())),
            _ => ::anyhow::bail!("unknown_reference_type"),
        }
    }
}

pub mod claim {
    use protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub struct Claim {
        claim_type: u64,
        claim_fields: ::std::vec::Vec<crate::protocol::ClaimFieldEntry>,
    }

    impl Claim {
        pub fn new(
            claim_type: u64,
            claim_fields: &[crate::protocol::ClaimFieldEntry],
        ) -> Claim {
            Claim {
                claim_type,
                claim_fields: claim_fields.to_owned(),
            }
        }

        pub fn claim_type(&self) -> &u64 {
            &self.claim_type
        }

        pub fn claim_fields(
            &self,
        ) -> &::std::vec::Vec<crate::protocol::ClaimFieldEntry> {
            &self.claim_fields
        }
    }

    pub fn to_proto(claim: &Claim) -> crate::protocol::Claim {
        let mut proto = crate::protocol::Claim::new();
        proto.claim_type = *claim.claim_type();
        proto.claim_fields = claim.claim_fields().clone();
        proto
    }

    pub fn from_proto(proto: &crate::protocol::Claim) -> Claim {
        Claim::new(proto.claim_type, &proto.claim_fields)
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
    use protobuf::Message;

    #[derive(PartialEq, Clone, Debug)]
    pub enum Content {
        Delete(crate::model::delete::Delete),
        Claim(crate::model::claim::Claim),
        Unknown(u64, ::std::vec::Vec<u8>),
    }

    pub fn decode_content(
        content_type: u64,
        content: &[u8],
    ) -> ::anyhow::Result<Content> {
        match content_type {
            1 => {
                let proto = crate::protocol::Delete::parse_from_bytes(content)
                    .map_err(::anyhow::Error::new)?;

                Ok(Content::Delete(crate::model::delete::from_proto(&proto)?))
            }
            12 => {
                let proto = crate::protocol::Claim::parse_from_bytes(content)
                    .map_err(::anyhow::Error::new)?;

                Ok(Content::Claim(crate::model::claim::from_proto(&proto)))
            }
            _ => Ok(Content::Unknown(content_type, content.to_owned())),
        }
    }

    pub fn content_type(content: &Content) -> u64 {
        match content {
            Content::Delete(_) => 1,
            Content::Claim(_) => 12,
            Content::Unknown(content_type, _) => *content_type,
        }
    }

    pub fn encode_content(
        content: &Content,
    ) -> ::anyhow::Result<::std::vec::Vec<u8>> {
        match content {
            Content::Delete(body) => crate::model::delete::to_proto(body)
                .write_to_bytes()
                .map_err(::anyhow::Error::new),
            Content::Claim(body) => crate::model::claim::to_proto(body)
                .write_to_bytes()
                .map_err(::anyhow::Error::new),
            Content::Unknown(_, body) => Ok(body.clone()),
        }
    }
}

#[cfg(test)]
pub mod tests {
    use protobuf::Message;
    use rand::Rng;

    #[test]
    fn signed_event_to_from_protobuf_event_is_isomorphic() {
        let identity_keypair = crate::test_utils::make_test_keypair();

        let process = crate::test_utils::make_test_process();

        let signed_event =
            crate::test_utils::make_test_event(&identity_keypair, &process, 52);

        let protobuf_event =
            crate::model::signed_event::to_proto(&signed_event);

        let parsed_event =
            crate::model::signed_event::from_proto(&protobuf_event).unwrap();

        assert!(signed_event == parsed_event);
    }
}

#[allow(clippy::large_enum_variant)]
#[derive(PartialEq, Clone, Debug)]
pub enum PointerOrByteReferences {
    Pointer(crate::model::pointer::Pointer),
    Bytes(::std::vec::Vec<::std::vec::Vec<u8>>),
}
