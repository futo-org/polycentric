use opensearch::{
    indices::{IndicesCreateParts, IndicesExistsParts, IndicesPutMappingParts},
    OpenSearch,
};

#[derive(::serde::Deserialize, ::serde::Serialize)]
struct OpenSearchSearchDocumentMessage {
    author_public_key: String,
    writer_id: String,
    sequence_number: i64,
    message: Option<String>,
}

#[derive(::serde::Deserialize, ::serde::Serialize)]
struct OpenSearchSearchDocumentProfile {
    pub(crate) author_public_key: String,
    pub(crate) writer_id: String,
    pub(crate) sequence_number: i64,
    pub(crate) profile_name: String,
    pub(crate) profile_description: Option<String>,
    pub(crate) unix_milliseconds: u64,
}

#[derive(::serde::Deserialize, ::serde::Serialize)]
pub(crate) struct OpenSearchContent {
    pub(crate) message_content: String,
    // only serialize when it's not None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) unix_milliseconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) byte_reference: Option<String>,
}

#[derive(::serde::Deserialize)]
pub(crate) struct OpenSearchSearchHitsL2 {
    pub(crate) _source: OpenSearchContent,
    pub(crate) _id: String,
    pub(crate) _index: String,
}

#[derive(::serde::Deserialize)]
pub(crate) struct OpenSearchSearchHitsL1 {
    pub(crate) hits: ::std::vec::Vec<OpenSearchSearchHitsL2>,
}

#[derive(::serde::Deserialize)]
pub(crate) struct OpenSearchAggregationBucketL3 {
    pub(crate) key: String,
    pub(crate) doc_count: i64,
}

#[derive(::serde::Deserialize)]
pub(crate) struct OpenSearchAggregationsL2 {
    pub(crate) buckets: ::std::vec::Vec<OpenSearchAggregationBucketL3>,
}

#[derive(::serde::Deserialize)]
pub(crate) struct OpenSearchAggregationsL1 {
    pub(crate) top_byte_references: Option<OpenSearchAggregationsL2>,
}

#[derive(::serde::Deserialize)]
pub(crate) struct OpenSearchSearchL0 {
    pub(crate) hits: Option<OpenSearchSearchHitsL1>,
    pub(crate) aggregations: Option<OpenSearchAggregationsL1>,
}

pub(crate) async fn prepare_indices(
    opensearch_client: &OpenSearch,
) -> Result<opensearch::http::response::Response, opensearch::Error> {
    // Check if the index exists
    let response = opensearch_client
        .indices()
        .exists(IndicesExistsParts::Index(&["messages"]))
        .send()
        .await;

    let index_exists = match response {
        Ok(response) => response.status_code().is_success(),
        Err(_) => false,
    };

    if !index_exists {
        let mappings = serde_json::json!({
            "mappings": {
                "properties": {
                    "message_content": { "type": "text",
                    "fields": {
                      "keyword": {
                        "type": "keyword",
                        "ignore_above" : 256
                      }
                    } },
                    "byte_reference": { "type": "text",
                    "fields": {
                      "keyword": {
                        "type": "keyword",
                        "ignore_above" : 256
                      }
                    } },
                    "unix_milliseconds": { "type": "date", "format": "epoch_millis" }
                }
            }
        });

        opensearch_client
            .indices()
            .create(IndicesCreateParts::Index("messages"))
            .body(mappings)
            .send()
            .await
    } else {
        // If the index already exists, we need to update the mappingsa
        let mappings = serde_json::json!({
            "properties": {
                "message_content": { "type": "text",
                "fields": {
                  "keyword": {
                    "type": "keyword",
                    "ignore_above" : 256
                  }
                } },
                "byte_reference": {
                    "type": "text",
                    "fields": {
                    "keyword": {
                        "type": "keyword",
                        "ignore_above" : 256
                    }
                }
            },
                "unix_milliseconds": { "type": "date", "format": "epoch_millis" }
            }
        });

        opensearch_client
            .indices()
            .put_mapping(IndicesPutMappingParts::Index(&["messages"]))
            .body(mappings)
            .send()
            .await
    }
}
