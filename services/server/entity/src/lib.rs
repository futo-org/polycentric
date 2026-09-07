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
//!  * [`content_post`](content_post_model)
//!  * [`content_delete`](content_delete_model)
//!  * [`content_follow`](content_follow_model)
//!  * [`content_block`](content_block_model)
//!  * [`content_reaction`](content_reaction_model)
//!  * [`content_profile_update`](content_profile_update_model)
//!  * [`content_identity`](content_identity_model)
//!  * [`content_repost`](content_repost_model)
//!  * [`content_report`](content_report_model)
//!  * [`content_label`](content_label_model)
//!  * [`content_verification_claim`](content_verification_claim_model)
//!  * [`content_verification_verify`](content_verification_verify_model)
//!  * [`content_verification_target`](content_verification_target_model)
//!  * [`content_blob`](content_blob_model)
//!  * [`content_image`](content_image_model)
//!
//! These content tables allow for easy acces to the content of the event. Note
//! that only a single content row (plus one row in sub-table) is created for
//! each unique event. This means that if two events contain the same thing,
//! e.g. a post with the same text, only a single content row is created.
//!
//! The event rows are joined to a content row on the content digest bytes,
//! [`event_model::Model::content_digest_bytes`] and
//! [`content_model::Model::digest_bytes`]. The content sub-tables are join on
//! the content id.
//!
//! ## Cache Tables
//!
//! We also have cache tables that contain various pre-computed values to make
//! it easier and cheapier to query for them. These include the following tables:
//!  * [`follow`](follow_model) contains a list of which identities are
//!    following which.
//!  * [`reaction`](reaction_model) and [`reaction_tally`](reaction_tally_model)
//!    contains the reaction made on posts.
//!  * [`repost`](repost_model) contains the reposts of posts made.
//!  * [`quote`](quote_model) contains the posts that are quoted by another post.
//!  * [`reply`](reply_model) contains the posts that are replied by another post.
//!
//! The cache tables represent the current state, meaning that a delete event
//! will remove it from the cache table, but the original event remains in the
//! `events` table.
//!
//! [`events`]: event_model
//! [`content`]: content_model

pub mod application_model;
pub mod attributed_to_reaction_summary_model;
pub mod ban_model;
pub mod block_model;
pub mod content_attributed_to_reaction_model;
pub mod content_blob_model;
pub mod content_block_model;
pub mod content_delete_model;
pub mod content_follow_model;
pub mod content_identity_model;
pub mod content_image_model;
pub mod content_label_model;
pub mod content_model;
pub mod content_post_attributed_url_model;
pub mod content_post_model;
pub mod content_profile_update_model;
pub mod content_reaction_model;
pub mod content_report_model;
pub mod content_repost_model;
pub mod content_verification_claim_model;
pub mod content_verification_target_model;
pub mod content_verification_verify_model;
pub mod default_follow_suggestion_model;
pub mod event_model;
pub mod follow_model;
pub mod gravity_model;
pub mod moderator_model;
pub mod notification;
pub mod pairing_session_claimer_model;
pub mod pairing_session_model;
pub mod quote_model;
pub mod reaction_model;
pub mod reaction_tally_model;
pub mod reply_model;
pub mod repost_model;
pub mod url_info_cache_model;
pub mod verification_schema_model;
