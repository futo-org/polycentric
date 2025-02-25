use ::opensearch::SearchParts;
use ::protobuf::Message;
use ::serde_json::json;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    query: ::std::option::Option<String>,
    limit: ::std::option::Option<u64>,
    time_range: ::std::option::Option<String>,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let limit = ::std::cmp::min(query.limit.unwrap_or(10), 10);

    let time_range: String = match query.time_range {
        Some(time_range) => match time_range.as_str() {
            "12h" => "now-12h/h",
            "1d" => "now-1d/d",
            "7d" => "now-7d/d",
            "30d" => "now-30d/d",
            _ => "now-30d/d",
        },
        _ => "now-30d/d",
    }
    .to_string();

    Ok(crate::warp_try_err_500!(
        handler_inner(state, query.query, limit, time_range,).await
    ))
}

fn escape_opensearch_query(query: &str) -> String {
    let special_strings = [
        "+", "-", "&&", "||", "!", "(", ")", "{", "}", "[", "]", "^", "~", "*",
        "?", ":", "\"", "\\\\",
    ];
    let mut escaped_query = query.to_string();

    for s in special_strings {
        escaped_query = escaped_query.replace(s, &format!("\\{}", s));
    }

    escaped_query
}

pub(crate) async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    query: Option<String>,
    limit: u64,
    time_range: String,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    let should_clause = if let Some(ref q) = query {
        // if the query starts with a slash it messes up the wildcard query because the tokenizer strips it for the index

        let q_without_starting_slash = q.strip_prefix('/').unwrap_or(q);
        let escaped_wildcard_query =
            escape_opensearch_query(q_without_starting_slash);

        json!([
            {
                "match": {
                    "byte_reference": {
                        "query": q,
                        "fuzziness": "AUTO"
                    }
                }
            },
            {
                "wildcard": {
                    "byte_reference": escaped_wildcard_query + "*"
                }
            }
        ])
    } else {
        json!([])
    };

    let response = state
        .search
        .search(SearchParts::Index(&["messages"]))
        .body(json!({
                "size": 0,
                "query": {
                  "bool": {
                    "should": should_clause,
                    "minimum_should_match": match query {
                      Some(_) => 1,
                      None => 0,
                    },
                    "filter": [
                      {
                        "range": {
                          "unix_milliseconds": {
                            "gte": time_range,
                            "lte": "now/d",
                            "format": "epoch_millis"
                          }
                        }
                      }
                    ]
                  }
                },
                "aggs": {
                  "top_byte_references": {
                    "terms": {
                      "field": "byte_reference.keyword",
                      "size": limit as i64,
                      "order": {
                        "_count": "desc"
                      }
                    }
                  }
                }
        }))
        .send()
        .await?;

    let response_body = response
        .json::<crate::opensearch::OpenSearchSearchL0>()
        .await?;

    let mut result =
        polycentric_protocol::protocol::ResultTopStringReferences::new();

    if let Some(aggregations) = response_body.aggregations {
        if let Some(top_byte_references) = aggregations.top_byte_references {
            for bucket in top_byte_references.buckets {
                let mut result_aggregation_bucket =
                    polycentric_protocol::protocol::AggregationBucket::new();

                result_aggregation_bucket.key = bucket.key.as_bytes().to_vec();
                result_aggregation_bucket.value = bucket.doc_count;

                result.buckets.push(result_aggregation_bucket);
            }
        }
    }

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result.write_to_bytes()?,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
