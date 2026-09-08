use sea_orm::entity::prelude::*;

/// Cached link-preview metadata for a URL, fetched via the scraper.
/// A row with `error_code` set is a cached scrape failure; otherwise
/// `title`/`description`/`image` hold the scraped metadata. Freshness
/// is judged against `updated_at`, which every re-scrape refreshes.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "url_info_cache")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub url: String,
    pub title: String,
    pub description: String,
    pub image: String,
    // Raw JSON body the scraper returned for a successful scrape.
    pub raw_response: Option<String>,
    pub error_code: Option<i32>,
    pub error_message: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
