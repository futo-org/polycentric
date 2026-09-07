pub use sea_orm_migration::prelude::*;

mod m20220101_000001_create_table;
mod m20260430_000002_add_pairing_tables;
mod m20260504_000001_create_push_token_table;
mod m20260514_000001_widen_event_sequence;
mod m20260521_000001_add_event_previous_root;
mod m20260526_000001_add_content_post_quote;
mod m20260526_000002_add_content_repost_table;
mod m20260528_000001_reaction_opinion_to_positive;
mod m20260601_000001_add_content_report_table;
mod m20260601_000001_add_follower_lookup_indexes;
mod m20260604_000001_add_content_label_table;
mod m20260617_000001_add_notification_table;
mod m20260617_000002_drop_push_token_table;
mod m20260618_000001_timestamps_to_timestamptz;
mod m20260625_000001_add_event_key_indices;
mod m20260630_000001_add_verification_tables;
mod m20260707_164130_add_indices_for_sorting;
mod m20260707_191447_add_reply_counts_table;
mod m20260714_000001_add_url_info_cache_table;
mod m20260715_000001_add_moderator_table;
mod m20260717_000001_add_url_info_cache_raw_response;
mod m20260720_164457_add_reaction_counters;
mod m20260721_000001_add_ban_table;
mod m20260723_000001_add_ban_pagination_index;
mod m20260723_000002_add_ban_banned_by;
mod m20260727_000001_add_content_identity_field_columns;
mod m20260728_000001_add_content_post_attributed_url_table;
mod m20260804_000001_add_verification_claim_fields_index;
mod m20260804_000001_update_content_profile_update_columns;
mod m20260804_000003_content_profile_update_search_data;
mod m20260806_000001_content_post_search_data;
mod m20260807_000001_migrate_missing_content_profile_update_data;
mod m20260807_000002_align_report_categories_with_labels;
mod m20260810_000001_search_query_function;
mod m20260812_000001_add_content_attributed_to_reaction_table;
mod m20260812_000001_follow_table;
mod m20260812_000002_add_attributed_to_reaction_summaries;
mod m20260812_000002_fill_follow_table;
mod m20260812_000003_reaction_table;
mod m20260812_000004_backfill_reaction_tally_table;
mod m20260813_000001_block_table;
mod m20260817_000001_reaction_identity;
mod m20260817_000002_repost_table;
mod m20260818_000001_qoute_table;
mod m20260818_000002_reply_table;
mod m20260818_000003_reaction_count_decay;
mod m20260825_000001_default_follow_suggestions;
mod m20260826_195541_recreate_pairing_tables;
mod m20260831_000001_always_include_hashtags_in_search_data;
mod m20260831_000002_reaction_tally_decayed_count;
mod m20260901_000001_reaction_emoji_nullable;
mod m20260902_000001_add_event_application;
mod m20260903_000001_cache_post_indexes;
mod m20260903_000001_reaction_decay_clamp_base;
mod m20260903_000002_content_post_reply_parent_index;
mod m20260904_000001_remove_unused_tables;
mod m20260904_000003_recommended_feed_indices;

mod old_entity;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20220101_000001_create_table::Migration),
            Box::new(m20260430_000002_add_pairing_tables::Migration),
            Box::new(m20260504_000001_create_push_token_table::Migration),
            Box::new(m20260514_000001_widen_event_sequence::Migration),
            Box::new(m20260521_000001_add_event_previous_root::Migration),
            Box::new(m20260526_000001_add_content_post_quote::Migration),
            Box::new(m20260526_000002_add_content_repost_table::Migration),
            Box::new(m20260528_000001_reaction_opinion_to_positive::Migration),
            Box::new(m20260601_000001_add_content_report_table::Migration),
            Box::new(m20260601_000001_add_follower_lookup_indexes::Migration),
            Box::new(m20260604_000001_add_content_label_table::Migration),
            Box::new(m20260617_000001_add_notification_table::Migration),
            Box::new(m20260617_000002_drop_push_token_table::Migration),
            Box::new(m20260618_000001_timestamps_to_timestamptz::Migration),
            Box::new(m20260625_000001_add_event_key_indices::Migration),
            Box::new(m20260630_000001_add_verification_tables::Migration),
            Box::new(m20260707_164130_add_indices_for_sorting::Migration),
            Box::new(m20260707_191447_add_reply_counts_table::Migration),
            Box::new(m20260714_000001_add_url_info_cache_table::Migration),
            Box::new(m20260715_000001_add_moderator_table::Migration),
            Box::new(m20260717_000001_add_url_info_cache_raw_response::Migration),
            Box::new(m20260720_164457_add_reaction_counters::Migration),
            Box::new(m20260721_000001_add_ban_table::Migration),
            Box::new(m20260723_000001_add_ban_pagination_index::Migration),
            Box::new(m20260723_000002_add_ban_banned_by::Migration),
            Box::new(m20260727_000001_add_content_identity_field_columns::Migration),
            Box::new(m20260728_000001_add_content_post_attributed_url_table::Migration),
            Box::new(m20260804_000001_add_verification_claim_fields_index::Migration),
            Box::new(m20260804_000001_update_content_profile_update_columns::Migration),
            Box::new(m20260804_000003_content_profile_update_search_data::Migration),
            Box::new(m20260806_000001_content_post_search_data::Migration),
            Box::new(m20260807_000001_migrate_missing_content_profile_update_data::Migration),
            Box::new(m20260807_000002_align_report_categories_with_labels::Migration),
            Box::new(m20260810_000001_search_query_function::Migration),
            Box::new(m20260812_000001_add_content_attributed_to_reaction_table::Migration),
            Box::new(m20260812_000001_follow_table::Migration),
            Box::new(m20260812_000002_add_attributed_to_reaction_summaries::Migration),
            Box::new(m20260812_000002_fill_follow_table::Migration),
            Box::new(m20260812_000003_reaction_table::Migration),
            Box::new(m20260812_000004_backfill_reaction_tally_table::Migration),
            Box::new(m20260813_000001_block_table::Migration),
            Box::new(m20260817_000001_reaction_identity::Migration),
            Box::new(m20260817_000002_repost_table::Migration),
            Box::new(m20260818_000001_qoute_table::Migration),
            Box::new(m20260818_000002_reply_table::Migration),
            Box::new(m20260818_000003_reaction_count_decay::Migration),
            Box::new(m20260825_000001_default_follow_suggestions::Migration),
            Box::new(m20260826_195541_recreate_pairing_tables::Migration),
            Box::new(m20260901_000001_reaction_emoji_nullable::Migration),
            Box::new(m20260831_000001_always_include_hashtags_in_search_data::Migration),
            Box::new(m20260831_000002_reaction_tally_decayed_count::Migration),
            Box::new(m20260902_000001_add_event_application::Migration),
            Box::new(m20260903_000001_cache_post_indexes::Migration),
            Box::new(m20260903_000002_content_post_reply_parent_index::Migration),
            Box::new(m20260903_000001_reaction_decay_clamp_base::Migration),
            Box::new(m20260904_000001_remove_unused_tables::Migration),
            Box::new(m20260904_000003_recommended_feed_indices::Migration),
        ]
    }
}
