use serde::Deserialize;

pub(crate) fn deserialize_json_string<'de, D, T>(
    deserializer: D,
) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    // 1. First, get the raw string out of the query parameter
    let s = String::deserialize(deserializer)?;

    // 2. Attempt to parse that string as JSON
    serde_json::from_str(&s).map_err(serde::de::Error::custom)
}
