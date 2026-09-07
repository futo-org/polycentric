pub mod protos {
    include!(concat!(env!("OUT_DIR"), "/polycentric.rs"));
    include!(concat!(env!("OUT_DIR"), "/polycentric_ffi.rs"));
}

// `large_enum_variant`: generated prost oneofs (e.g. Content.ContentBody) hold
// their largest message variant inline; boxing would change the generated API
// at every call site for no real benefit on deserialized-once messages.
#[allow(dead_code, unused_attributes, clippy::large_enum_variant)]
pub mod protos_v2 {
    tonic::include_proto!("polycentric.v2");

    pub const FILE_DESCRIPTOR_SET: &[u8] =
        include_bytes!(concat!(env!("OUT_DIR"), "/polycentric_v2.bin"));
}

pub mod traits;

pub mod collections;
pub mod content;
pub mod content_digest;
pub mod event;
pub mod event_key;
pub mod identity;
pub mod moderation_label;
pub mod moderation_tag;
pub mod pointer;
pub mod public_key;
pub mod query_engine_stats;
pub mod signed_event;
pub mod signed_issuer_state;
pub mod signed_message;
pub mod vector_clock;

pub use traits::Serializable;

pub use crate::models::protos::*;
