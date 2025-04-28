use serde::Deserialize;

// Default limit for pagination
const DEFAULT_PAGE_LIMIT: u64 = 25;
// Max limit to prevent excessive requests
const MAX_PAGE_LIMIT: u64 = 100;

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    // Use serde default for both. Default for u64 is 0.
    #[serde(default)]
    limit: u64,
    #[serde(default)]
    offset: u64,
}

impl PaginationParams {
    pub fn limit(&self) -> u64 {
        if self.limit == 0 { // If limit wasn't provided (or explicitly 0), use default
            DEFAULT_PAGE_LIMIT
        } else {
            // Enforce max limit and ensure it's at least 1
            self.limit.min(MAX_PAGE_LIMIT).max(1)
        }
    }

    pub fn offset(&self) -> u64 {
        // Offset defaults to 0 correctly via #[serde(default)]
        self.offset
    }
} 