use opensearch::{
    indices::{IndicesCreateParts, IndicesExistsParts, IndicesPutMappingParts},
    OpenSearch,
};

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
