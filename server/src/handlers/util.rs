use serde::Deserialize;

pub(crate) fn deserialize_json_string<'de, D, T>(
    deserializer: D,
) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let opt = Option::<String>::deserialize(deserializer)?;
    if let Some(s) = opt {
        if s.trim().is_empty() {
            Ok(None)
        } else {
            serde_json::from_str(&s)
                .map(Some)
                .map_err(serde::de::Error::custom)
        }
    } else {
        Ok(None)
    }
}
