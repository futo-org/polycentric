// Disallow `unwrap` and `expect`, such that we ensure potential panic
// conditions are not introduced
#![cfg_attr(not(test), warn(clippy::unwrap_used, clippy::expect_used))]

// You must call this once
uniffi::setup_scaffolding!();

// Nothing here references it, but the cdylib must export its allocator and
// panic hook for the ubrn wasm player to call into.
#[cfg(target_arch = "wasm32")]
extern crate uniffi_runtime_wasm as _;

pub mod api;
pub mod client;
pub mod identity;
mod lock;
pub mod logging;
pub mod media;
pub mod pairing;
pub mod query;
pub mod rx;
pub mod store;
pub mod sync;
pub mod time;
pub mod vector_clock;
