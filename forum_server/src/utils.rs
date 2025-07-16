use serde::Deserialize;

const DEFAULT_PAGE_LIMIT: u64 = 25;
const MAX_PAGE_LIMIT: u64 = 100;

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    #[serde(default)]
    limit: u64,
    #[serde(default)]
    offset: u64,
}

impl PaginationParams {
    pub fn limit(&self) -> u64 {
        if self.limit == 0 {
            DEFAULT_PAGE_LIMIT
        } else {
            self.limit.min(MAX_PAGE_LIMIT).max(1)
        }
    }

    pub fn offset(&self) -> u64 {
        self.offset
    }
} 