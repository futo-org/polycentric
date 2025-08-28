pub mod config;
pub mod crypto;
pub mod db;
pub mod handlers;
pub mod models;
pub mod websocket;

// Include the generated protobuf code
pub mod protos {
    include!(concat!(env!("OUT_DIR"), "/protos/mod.rs"));
}

// Re-export commonly used types
pub use crypto::*;
pub use models::*;
