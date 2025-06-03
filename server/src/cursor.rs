use anyhow::{anyhow, bail, Context};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExploreCursor {
    pub timestamp: Option<i64>,
    pub id: i64,
}

impl ExploreCursor {
    const TIMESTAMP_SIZE: usize = 8;
    const ID_SIZE: usize = 8;
    const FULL_CURSOR_SIZE: usize = Self::TIMESTAMP_SIZE + Self::ID_SIZE; // 16 bytes
    const ID_ONLY_SIZE: usize = Self::ID_SIZE; // 8 bytes

    pub fn new(timestamp: Option<i64>, id: i64) -> Self {
        Self { timestamp, id }
    }

    // Constructor for cursors with a timestamp
    pub fn with_timestamp(timestamp: i64, id: i64) -> Self {
        Self {
            timestamp: Some(timestamp),
            id,
        }
    }

    // Constructor for cursors with only an ID (timestamp is None)
    pub fn id_only(id: i64) -> Self {
        Self {
            timestamp: None,
            id,
        }
    }

    // Special instance for the "first page" effective cursor in descending order
    // (used when no cursor is provided to load_posts_before_id)
    pub fn descending_first_page() -> Self {
        Self {
            timestamp: None, // SQL query handles this with `unix_milliseconds <= $1` where $1 is NULL initially
            id: i64::MAX, // Ensures we get items with id < MAX_ID for the first page
        }
    }

    // Special instance for the "first page" effective cursor in ascending order
    // (used when no cursor is provided to load_events_after_id)
    pub fn ascending_first_page() -> Self {
        Self {
            timestamp: None, // SQL query handles this with `unix_milliseconds >= $1` where $1 is NULL initially
            id: 0, // Ensures we get items with id > 0 for the first page
        }
    }

    pub fn from_base64_str(cursor_str: &str) -> anyhow::Result<Self> {
        let bytes = ::base64::decode_config(cursor_str, ::base64::URL_SAFE)
            .context("Cursor base64 decoding failed")?;

        match bytes.len() {
            Self::FULL_CURSOR_SIZE => {
                let ts_bytes_slice = bytes
                    .get(0..Self::TIMESTAMP_SIZE)
                    .context("Invalid cursor: missing timestamp bytes")?;
                let id_bytes_slice = bytes
                    .get(Self::TIMESTAMP_SIZE..Self::FULL_CURSOR_SIZE)
                    .context("Invalid cursor: missing id bytes")?;

                let ts_array: [u8; Self::TIMESTAMP_SIZE] =
                    ts_bytes_slice.try_into().map_err(|_| {
                        anyhow!(
                            "Invalid cursor: timestamp part not {} bytes",
                            Self::TIMESTAMP_SIZE
                        )
                    })?;
                let id_array: [u8; Self::ID_SIZE] =
                    id_bytes_slice.try_into().map_err(|_| {
                        anyhow!(
                            "Invalid cursor: id part not {} bytes",
                            Self::ID_SIZE
                        )
                    })?;

                let timestamp = i64::from_le_bytes(ts_array);
                let id = i64::from_le_bytes(id_array);
                Ok(Self::with_timestamp(timestamp, id))
            }
            Self::ID_ONLY_SIZE => {
                let id_array: [u8; Self::ID_SIZE] =
                    bytes.as_slice().try_into().map_err(|_| {
                        anyhow!(
                            "Invalid cursor: single component not {} bytes",
                            Self::ID_SIZE
                        )
                    })?;
                let id = i64::from_le_bytes(id_array);
                Ok(Self::id_only(id))
            }
            len => bail!(
                "Invalid cursor length: expected {} or {} bytes, got {}",
                Self::FULL_CURSOR_SIZE,
                Self::ID_ONLY_SIZE,
                len
            ),
        }
    }

    pub fn to_bytes(self) -> Vec<u8> {
        let mut bytes_vec = Vec::with_capacity(Self::FULL_CURSOR_SIZE);
        if let Some(timestamp) = self.timestamp {
            bytes_vec.extend_from_slice(&timestamp.to_le_bytes());
            bytes_vec.extend_from_slice(&self.id.to_le_bytes());
        } else {
            bytes_vec.extend_from_slice(&self.id.to_le_bytes());
        }
        bytes_vec
    }

    pub fn to_base64_str(self) -> String {
        ::base64::encode_config(self.to_bytes(), ::base64::URL_SAFE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cursor_serialization_deserialization() {
        // Full cursor
        let original_full = ExploreCursor::with_timestamp(1234567890, 101);
        let b64_full = original_full.to_base64_str();
        let deserialized_full =
            ExploreCursor::from_base64_str(&b64_full).unwrap();
        assert_eq!(original_full, deserialized_full);
        assert_eq!(
            original_full.to_bytes().len(),
            ExploreCursor::FULL_CURSOR_SIZE
        );

        // ID-only cursor
        let original_id_only = ExploreCursor::id_only(202);
        let b64_id_only = original_id_only.to_base64_str();
        let deserialized_id_only =
            ExploreCursor::from_base64_str(&b64_id_only).unwrap();
        assert_eq!(original_id_only, deserialized_id_only);
        assert_eq!(
            original_id_only.to_bytes().len(),
            ExploreCursor::ID_ONLY_SIZE
        );

        // Test decoding full cursor bytes
        let mut full_bytes = Vec::new();
        full_bytes.extend_from_slice(&123i64.to_le_bytes());
        full_bytes.extend_from_slice(&456i64.to_le_bytes());
        let b64_encoded_full =
            ::base64::encode_config(&full_bytes, ::base64::URL_SAFE);
        let cursor_full =
            ExploreCursor::from_base64_str(&b64_encoded_full).unwrap();
        assert_eq!(cursor_full.timestamp, Some(123));
        assert_eq!(cursor_full.id, 456);

        // Test decoding id-only cursor bytes
        let id_only_bytes = 789i64.to_le_bytes().to_vec();
        let b64_encoded_id_only =
            ::base64::encode_config(&id_only_bytes, ::base64::URL_SAFE);
        let cursor_id_only =
            ExploreCursor::from_base64_str(&b64_encoded_id_only).unwrap();
        assert_eq!(cursor_id_only.timestamp, None);
        assert_eq!(cursor_id_only.id, 789);
    }

    #[test]
    fn test_invalid_cursor_length() {
        let invalid_b64 =
            ::base64::encode_config(vec![1, 2, 3, 4], ::base64::URL_SAFE);
        let result = ExploreCursor::from_base64_str(&invalid_b64);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            format!(
                "Invalid cursor length: expected {} or {} bytes, got {}",
                ExploreCursor::FULL_CURSOR_SIZE,
                ExploreCursor::ID_ONLY_SIZE,
                4
            )
        );
    }

    #[test]
    fn test_invalid_base64() {
        let result =
            ExploreCursor::from_base64_str("invalid-base64-string-$%^");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .starts_with("Cursor base64 decoding failed"));
    }
}
