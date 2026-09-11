//! Database tables, types and docs.
//!
//! # Tables
//!
//! The design uses event sourcing, where each operation is stored as an event.
//! These events are stored in the [`events`] table, which is the core of the
//! storage. It contains all the events received by the users, even once we
//! don't consider valid (e.g. when a user tries to delete a post belong to
//! another user).
//!
//! ## Content Tables
//!
//! The decoded content of these events are stored in the [`content`] and related
//! `content_*` tables (depending on the type of event):
//!  * [`content_post`]
//!  * [`content_delete`]
//!  * [`content_follow`]
//!  * [`content_block`]
//!  * [`content_reaction`]
//!  * [`content_profile_update`]
//!  * [`content_identity`]
//!  * [`content_repost`]
//!  * [`content_report`]
//!  * [`content_label`]
//!  * [`content_verification_claim`]
//!  * [`content_verification_verify`]
//!  * [`content_verification_target`]
//!  * [`content_blob`]
//!  * [`content_image`]
//!
//! These content tables allow for easy acces to the content of the event. Note
//! that only a single content row (plus one row in sub-table) is created for
//! each unique event. This means that if two events contain the same thing,
//! e.g. a post with the same text, only a single content row is created.
//!
//! The event rows are joined to a content row on the content digest bytes,
//! [`event::Model::content_digest_bytes`] and
//! [`content::Model::digest_bytes`]. The content sub-tables are join on
//! the content id.
//!
//! ## Cache Tables
//!
//! We also have cache tables that contain various pre-computed values to make
//! it easier and cheapier to query for them. These include the following tables:
//!  * [`follow`] contains a list of which identities are following which.
//!  * [`reaction`] and [`reaction_tally`] contains the reaction made on posts.
//!  * [`repost`] contains the reposts of posts made.
//!  * [`quote`] contains the posts that are quoted by another post.
//!  * [`reply`] contains the posts that are replied by another post.
//!  * [`profile`] contains the latest profile information for an identity.
//!
//! The cache tables represent the current state, meaning that a delete event
//! will remove it from the cache table, but the original event remains in the
//! `events` table.
//!
//! [`events`]: event
//! [`content`]: content

pub mod alias_cache;
pub mod application;
pub mod attributed_to_reaction_summary;
pub mod ban;
pub mod block;
pub mod content;
pub mod content_attributed_to_reaction;
pub mod content_blob;
pub mod content_block;
pub mod content_delete;
pub mod content_follow;
pub mod content_identity;
pub mod content_image;
pub mod content_label;
pub mod content_post;
pub mod content_post_attributed_url;
pub mod content_profile_update;
pub mod content_reaction;
pub mod content_report;
pub mod content_repost;
pub mod content_verification_claim;
pub mod content_verification_target;
pub mod content_verification_verify;
pub mod default_follow_suggestion;
pub mod event;
pub mod follow;
pub mod gravity;
pub mod moderator;
pub mod notification;
pub mod pairing_session;
pub mod pairing_session_claimer;
pub mod profile;
pub mod quote;
pub mod reaction;
pub mod reaction_tally;
pub mod reply;
pub mod repost;
pub mod url_info_cache;
pub mod verification_schema;
