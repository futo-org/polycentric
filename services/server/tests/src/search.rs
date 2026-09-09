//! Tests for the search service.

use crate::*;
use prost::Message;

#[tokio::test]
async fn search_users_no_match() {
    expect_searched_users(
        SearchUsersRequest {
            query: random_string(),
            sort_by: None,
            page_params: None,
        },
        Vec::new(),
    )
    .await;
}

#[tokio::test]
async fn search_users_match_profile_name() {
    let mut client = TestClient::new().await;

    let profile_name = random_string();
    let profile_update = ProfileUpdate {
        name: Some(profile_name.clone()),
        avatar: None,
        banner: None,
        description: None,
        alias: None,
    };
    client.profile_update(profile_update.clone(), DEFAULT_CREATED_AT);
    client.submit_events().await;

    expect_searched_users(
        SearchUsersRequest {
            query: profile_name,
            sort_by: None,
            page_params: None,
        },
        vec![profile_update],
    )
    .await;
}

#[tokio::test]
async fn search_users_match_description() {
    let mut client = TestClient::new().await;

    let description = random_string();
    let profile_update = ProfileUpdate {
        name: Some(random_string()),
        avatar: None,
        banner: None,
        description: Some(description.clone()),
        alias: None,
    };
    client.profile_update(profile_update.clone(), DEFAULT_CREATED_AT);
    client.submit_events().await;

    expect_searched_users(
        SearchUsersRequest {
            query: description.clone(),
            sort_by: None,
            page_params: None,
        },
        vec![profile_update],
    )
    .await;
}

#[tokio::test]
async fn search_users_match_alias() {
    let mut client = TestClient::new().await;

    let alias = random_string();
    let profile_update = ProfileUpdate {
        name: Some(random_string()),
        avatar: None,
        banner: None,
        description: None,
        alias: Some(alias.clone()),
    };
    client.profile_update(profile_update.clone(), DEFAULT_CREATED_AT);
    client.submit_events().await;

    expect_searched_users(
        SearchUsersRequest {
            query: alias,
            sort_by: None,
            page_params: None,
        },
        vec![profile_update],
    )
    .await;
}

#[tokio::test]
async fn search_users_match_on_hashtags() {
    let mut client = TestClient::new().await;

    let profile_name = "#a #some";
    let profile_update = ProfileUpdate {
        name: Some(profile_name.into()),
        avatar: None,
        banner: None,
        description: None,
        alias: None,
    };
    client.profile_update(profile_update.clone(), DEFAULT_CREATED_AT);
    client.submit_events().await;

    expect_searched_users(
        SearchUsersRequest {
            query: profile_name.into(),
            sort_by: None,
            // Limit to 1 post as each time we test we create another. All we're
            // interested in is that one of them is returned, not which one.
            page_params: Some(PageParams {
                limit: Some(1),
                ..Default::default()
            }),
        },
        vec![profile_update],
    )
    .await;
}

#[tokio::test]
async fn search_users_order_by_rank() {
    let query = random_string();

    let mut expected = Vec::new();
    for n in 1..=3 {
        let mut client = TestClient::new().await;
        let description = repeated_string(n, &query, " ");
        let profile_update = ProfileUpdate {
            name: Some(random_string()),
            avatar: None,
            banner: None,
            description: Some(description),
            alias: None,
        };
        client.profile_update(profile_update.clone(), DEFAULT_CREATED_AT);
        client.submit_events().await;
        expected.push(profile_update);
    }
    // Reverse the results as the more hits we get, the higher the rank should be.
    expected.reverse();

    expect_searched_users(
        SearchUsersRequest {
            query,
            sort_by: None,
            page_params: None,
        },
        expected,
    )
    .await;
}

#[tokio::test]
async fn search_users_order_by_alpha() {
    let query = random_string();

    let mut expected = Vec::new();
    for (n, name) in ["A", "B", "C"].into_iter().enumerate() {
        let mut client = TestClient::new().await;
        let description = repeated_string(n + 1, &query, " ");
        let profile_update = ProfileUpdate {
            name: Some(name.to_owned()),
            avatar: None,
            banner: None,
            description: Some(description),
            alias: None,
        };
        client.profile_update(profile_update.clone(), DEFAULT_CREATED_AT);
        client.submit_events().await;
        expected.push(profile_update);
    }

    expect_searched_users(
        SearchUsersRequest {
            query,
            sort_by: Some(SortUsersBy::Alpha as _),
            page_params: None,
        },
        expected,
    )
    .await;
}

#[tokio::test]
async fn search_users_pagination_order_by_rank() {
    let mut search = search_service().await;
    let query = random_string();

    let mut expected = Vec::new();
    for n in 1..=3 {
        let mut client = TestClient::new().await;
        let description = repeated_string(n, &query, " ");
        let profile_update = ProfileUpdate {
            name: Some(random_string()),
            avatar: None,
            banner: None,
            description: Some(description),
            alias: None,
        };
        client.profile_update(profile_update.clone(), DEFAULT_CREATED_AT);
        client.submit_events().await;
        expected.push(profile_update);
    }
    // Reverse the results as the more hits we get, the higher the rank should be.
    expected.reverse();

    // Forward.
    let mut page_info: Option<PageInfo> = None;
    let mut expected_iter = expected.clone().into_iter();
    while let Some(expected) = expected_iter.next() {
        expect_searched_users2(
            SearchUsersRequest {
                query: query.clone(),
                sort_by: None,
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: None,
                    forward_token: page_info.take().map(|i| i.end_cursor),
                }),
            },
            vec![expected],
            |request| async {
                let SearchUsersResponse {
                    results,
                    page_info: p_i,
                    ..
                } = search.search_users(request).await.unwrap().into_inner();
                page_info = p_i;
                results
            },
        )
        .await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() != 2);
        assert_eq!(page_info.has_next_page, expected_iter.len() >= 1);
    }
    assert!(!page_info.as_ref().unwrap().has_next_page);

    // Backward.
    expected.reverse();
    let mut expected_iter = expected.clone().into_iter();
    let _ = expected_iter.next(); // Skip first (previously last) result.
    while let Some(expected) = expected_iter.next() {
        expect_searched_users2(
            SearchUsersRequest {
                query: query.clone(),
                sort_by: None,
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: page_info.take().map(|i| i.start_cursor),
                    forward_token: None,
                }),
            },
            vec![expected],
            |request| async {
                let mut search = search_service().await;
                let SearchUsersResponse {
                    results,
                    page_info: p_i,
                    ..
                } = search.search_users(request).await.unwrap().into_inner();
                page_info = p_i;
                results
            },
        )
        .await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() >= 1);
        assert_eq!(page_info.has_next_page, true);
    }
    assert!(!page_info.as_ref().unwrap().has_previous_page);
}

#[tokio::test]
async fn search_users_pagination_order_by_alpha() {
    let mut search = search_service().await;
    let query = random_string();

    let mut expected = Vec::new();
    for (n, name) in ["A", "B", "C"].into_iter().enumerate() {
        let mut client = TestClient::new().await;
        let description = repeated_string(n + 1, &query, " ");
        let profile_update = ProfileUpdate {
            name: Some(name.to_owned()),
            avatar: None,
            banner: None,
            description: Some(description),
            alias: None,
        };
        client.profile_update(profile_update.clone(), DEFAULT_CREATED_AT);
        client.submit_events().await;
        expected.push(profile_update);
    }

    // Forward.
    let mut page_info: Option<PageInfo> = None;
    let mut expected_iter = expected.clone().into_iter();
    while let Some(expected) = expected_iter.next() {
        expect_searched_users2(
            SearchUsersRequest {
                query: query.clone(),
                sort_by: Some(SortUsersBy::Alpha as _),
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: None,
                    forward_token: page_info.take().map(|i| i.end_cursor),
                }),
            },
            vec![expected],
            |request| async {
                let SearchUsersResponse {
                    results,
                    page_info: p_i,
                    ..
                } = search.search_users(request).await.unwrap().into_inner();
                page_info = p_i;
                results
            },
        )
        .await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() != 2);
        assert_eq!(page_info.has_next_page, expected_iter.len() >= 1);
    }
    assert!(!page_info.as_ref().unwrap().has_next_page);

    // Backward.
    expected.reverse();
    let mut expected_iter = expected.clone().into_iter();
    let _ = expected_iter.next(); // Skip first (previously last) result.
    while let Some(expected) = expected_iter.next() {
        expect_searched_users2(
            SearchUsersRequest {
                query: query.clone(),
                sort_by: Some(SortUsersBy::Alpha as _),
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: page_info.take().map(|i| i.start_cursor),
                    forward_token: None,
                }),
            },
            vec![expected],
            |request| async {
                let mut search = search_service().await;
                let SearchUsersResponse {
                    results,
                    page_info: p_i,
                    ..
                } = search.search_users(request).await.unwrap().into_inner();
                page_info = p_i;
                results
            },
        )
        .await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() >= 1);
        assert_eq!(page_info.has_next_page, true);
    }
    assert!(!page_info.as_ref().unwrap().has_previous_page);
}

async fn expect_searched_users(
    request: SearchUsersRequest,
    expected: Vec<ProfileUpdate>,
) {
    expect_searched_users2(request, expected, |request| async {
        let mut search = search_service().await;
        let response = search.search_users(request).await.unwrap();
        response.into_inner().results
    })
    .await
}

async fn expect_searched_users2<F, Fut>(
    request: SearchUsersRequest,
    expected: Vec<ProfileUpdate>,
    get_results: F,
) where
    F: FnOnce(SearchUsersRequest) -> Fut,
    Fut: Future<Output = Vec<SearchResult>>,
{
    eprintln!("query: {:#?}", request.query);
    let results = get_results(request).await;
    eprintln!("expected: {expected:#?}");
    eprintln!("results: {results:#?}");

    assert_eq!(
        results.len(),
        expected.len(),
        "unexpected amount of results"
    );
    for (result, expected) in results.into_iter().zip(expected) {
        let event = result.event_bundle.unwrap();
        let Some(serialized_content) = event.serialized_content.as_ref() else {
            panic!("missing content in event: {event:?}");
        };
        let Ok(content) = Content::decode(&*serialized_content.content_bytes)
        else {
            panic!("failed to decode event: {event:?}");
        };
        let Some(ContentBody::ProfileUpdate(update)) = content.content_body
        else {
            panic!("unexpected content body: {event:?}");
        };
        assert_eq!(update, expected);
        // Hard to assert the actual rank, so just check we have it.
        assert!(result.rank >= 0.0);
    }
}

#[tokio::test]
async fn search_posts_no_match() {
    expect_searched_posts(
        SearchPostsRequest {
            query: random_string(),
            sort_by: None,
            page_params: None,
            omit_labels: Vec::new(),
        },
        Vec::new(),
    )
    .await;
}

#[tokio::test]
async fn search_posts_match_text() {
    let mut client = TestClient::new().await;

    let post_text = random_string();
    client.post_text(&post_text, DEFAULT_CREATED_AT);
    client.submit_events().await;

    expect_searched_posts(
        SearchPostsRequest {
            query: post_text.clone(),
            sort_by: None,
            page_params: None,
            omit_labels: Vec::new(),
        },
        vec![Post {
            text: post_text,
            reply: None,
            images: vec![],
            quote: None,
            links: vec![],
            labels: vec![],
            attributed_to: vec![],
        }],
    )
    .await;
}

#[tokio::test]
async fn search_posts_match_on_hashtags() {
    let mut client = TestClient::new().await;

    let post_text = "#a #some";
    client.post_text(&post_text, DEFAULT_CREATED_AT);
    client.submit_events().await;

    expect_searched_posts(
        SearchPostsRequest {
            query: post_text.into(),
            sort_by: None,
            // Limit to 1 post as each time we test we create another. All we're
            // interested in is that one of them is returned, not which one.
            page_params: Some(PageParams {
                limit: Some(1),
                ..Default::default()
            }),
            omit_labels: Vec::new(),
        },
        vec![Post {
            text: post_text.into(),
            reply: None,
            images: vec![],
            quote: None,
            links: vec![],
            labels: vec![],
            attributed_to: vec![],
        }],
    )
    .await;
}

#[tokio::test]
async fn search_posts_order_by_rank() {
    let mut client = TestClient::new().await;

    let query = random_string();
    let post_text1 = format!("{query} first.");
    let post_text2 = format!("{query} second. {query}");
    client.post_text(&post_text1, DEFAULT_CREATED_AT);
    client.post_text(&post_text2, DEFAULT_CREATED_AT + 1);
    client.submit_events().await;

    expect_searched_posts(
        SearchPostsRequest {
            query,
            sort_by: Some(SortPostsBy::Default as _),
            page_params: None,
            omit_labels: Vec::new(),
        },
        vec![
            Post {
                text: post_text2,
                reply: None,
                images: vec![],
                quote: None,
                links: vec![],
                labels: vec![],
                attributed_to: vec![],
            },
            Post {
                text: post_text1,
                reply: None,
                images: vec![],
                quote: None,
                links: vec![],
                labels: vec![],
                attributed_to: vec![],
            },
        ],
    )
    .await;
}

#[tokio::test]
async fn search_posts_order_by_latest() {
    let mut client = TestClient::new().await;

    let query = random_string();
    let post_text1 = format!("{query} first.");
    let post_text2 = format!("{query} second.");
    client.post_text(&post_text1, DEFAULT_CREATED_AT);
    client.post_text(&post_text2, DEFAULT_CREATED_AT + 1);
    client.submit_events().await;

    expect_searched_posts(
        SearchPostsRequest {
            query,
            sort_by: Some(SortPostsBy::Latest as _),
            page_params: None,
            omit_labels: Vec::new(),
        },
        vec![
            Post {
                text: post_text2,
                reply: None,
                images: vec![],
                quote: None,
                links: vec![],
                labels: vec![],
                attributed_to: vec![],
            },
            Post {
                text: post_text1,
                reply: None,
                images: vec![],
                quote: None,
                links: vec![],
                labels: vec![],
                attributed_to: vec![],
            },
        ],
    )
    .await;
}

#[tokio::test]
async fn search_posts_omit_labels() {
    let query = random_string();
    let label = random_string();

    let mut client = TestClient::new().await;
    client.post_text(&query, DEFAULT_CREATED_AT);
    let post_event_key = client.get_last_event_key();
    client.submit_events().await;

    let (mut trusted_moderator, _guard) = TestClient::trusted_moderator().await;
    trusted_moderator.label(
        Labels {
            event_key: Some(post_event_key),
            label_values: vec![label.clone()],
        },
        DEFAULT_CREATED_AT + 1,
    );
    trusted_moderator.submit_events().await;

    expect_searched_posts(
        SearchPostsRequest {
            query,
            sort_by: None,
            page_params: None,
            omit_labels: vec![label],
        },
        vec![], // The post should be hidden.
    )
    .await;
}

#[tokio::test]
async fn search_posts_pagination_order_by_rank() {
    let mut search = search_service().await;
    let mut client = TestClient::new().await;

    let query = random_string();
    let mut expected = Vec::new();
    for n in 1..=3 {
        let text = format!("{n}. {}", repeated_string(n, &query, " "));
        client.post_text(&text, DEFAULT_CREATED_AT);
        expected.push(Post {
            text,
            reply: None,
            images: vec![],
            quote: None,
            links: vec![],
            labels: vec![],
            attributed_to: vec![],
        });
    }
    expected.reverse();
    client.submit_events().await;

    // Forward.
    let mut page_info: Option<PageInfo> = None;
    let mut expected_iter = expected.clone().into_iter();
    while let Some(expected) = expected_iter.next() {
        expect_searched_posts2(
            SearchPostsRequest {
                query: query.clone(),
                sort_by: None,
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: None,
                    forward_token: page_info.take().map(|i| i.end_cursor),
                }),
                omit_labels: Vec::new(),
            },
            vec![expected],
            |request| async {
                let SearchPostsResponse {
                    results,
                    page_info: p_i,
                    ..
                } = search.search_posts(request).await.unwrap().into_inner();
                page_info = p_i;
                results
            },
        )
        .await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() != 2);
        assert_eq!(page_info.has_next_page, expected_iter.len() >= 1);
    }
    assert!(!page_info.as_ref().unwrap().has_next_page);

    // Backward.
    expected.reverse();
    let mut expected_iter = expected.clone().into_iter();
    let _ = expected_iter.next(); // Skip first (previously last) result.
    while let Some(expected) = expected_iter.next() {
        expect_searched_posts2(
            SearchPostsRequest {
                query: query.clone(),
                sort_by: None,
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: page_info.take().map(|i| i.start_cursor),
                    forward_token: None,
                }),
                omit_labels: Vec::new(),
            },
            vec![expected],
            |request| async {
                let SearchPostsResponse {
                    results,
                    page_info: p_i,
                    ..
                } = search.search_posts(request).await.unwrap().into_inner();
                page_info = p_i;
                results
            },
        )
        .await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() >= 1);
        assert_eq!(page_info.has_next_page, true);
    }
    assert!(!page_info.as_ref().unwrap().has_previous_page);
}

#[tokio::test]
async fn search_posts_pagination_order_by_latest() {
    let mut search = search_service().await;
    let mut client = TestClient::new().await;

    let query = random_string();
    let mut expected = Vec::new();
    for n in 1..=3 {
        let text = format!("{n}. {query}.");
        client.post_text(&text, DEFAULT_CREATED_AT + n);
        expected.push(Post {
            text,
            reply: None,
            images: vec![],
            quote: None,
            links: vec![],
            labels: vec![],
            attributed_to: vec![],
        });
    }
    expected.reverse();
    client.submit_events().await;

    // Forward.
    let mut page_info: Option<PageInfo> = None;
    let mut expected_iter = expected.clone().into_iter();
    while let Some(expected) = expected_iter.next() {
        expect_searched_posts2(
            SearchPostsRequest {
                query: query.clone(),
                sort_by: Some(SortPostsBy::Latest as _),
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: None,
                    forward_token: page_info.take().map(|i| i.end_cursor),
                }),
                omit_labels: Vec::new(),
            },
            vec![expected],
            |request| async {
                let SearchPostsResponse {
                    results,
                    page_info: p_i,
                    ..
                } = search.search_posts(request).await.unwrap().into_inner();
                page_info = p_i;
                results
            },
        )
        .await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() != 2);
        assert_eq!(page_info.has_next_page, expected_iter.len() >= 1);
    }
    assert!(!page_info.as_ref().unwrap().has_next_page);

    // Backward.
    expected.reverse();
    let mut expected_iter = expected.clone().into_iter();
    let _ = expected_iter.next(); // Skip first (previously last) result.
    while let Some(expected) = expected_iter.next() {
        expect_searched_posts2(
            SearchPostsRequest {
                query: query.clone(),
                sort_by: Some(SortPostsBy::Latest as _),
                page_params: Some(PageParams {
                    limit: Some(1),
                    backward_token: page_info.take().map(|i| i.start_cursor),
                    forward_token: None,
                }),
                omit_labels: Vec::new(),
            },
            vec![expected],
            |request| async {
                let SearchPostsResponse {
                    results,
                    page_info: p_i,
                    ..
                } = search.search_posts(request).await.unwrap().into_inner();
                page_info = p_i;
                results
            },
        )
        .await;

        let page_info = page_info.as_ref().unwrap();
        assert_eq!(page_info.has_previous_page, expected_iter.len() >= 1);
        assert_eq!(page_info.has_next_page, true);
    }
    assert!(!page_info.as_ref().unwrap().has_previous_page);
}

async fn expect_searched_posts(
    request: SearchPostsRequest,
    expected: Vec<Post>,
) {
    expect_searched_posts2(request, expected, |request| async {
        let mut search = search_service().await;
        let response = search.search_posts(request).await.unwrap();
        response.into_inner().results
    })
    .await
}

async fn expect_searched_posts2<F, Fut>(
    request: SearchPostsRequest,
    expected: Vec<Post>,
    get_results: F,
) where
    F: FnOnce(SearchPostsRequest) -> Fut,
    Fut: Future<Output = Vec<SearchResult>>,
{
    eprintln!("query: {:#?}", request.query);
    let results = get_results(request).await;
    eprintln!("expected: {expected:#?}");
    eprintln!("results: {results:#?}");

    assert_eq!(
        results.len(),
        expected.len(),
        "unexpected amount of results"
    );
    for (result, expected) in results.into_iter().zip(expected) {
        let event = result.event_bundle.unwrap();
        let Some(serialized_content) = event.serialized_content.as_ref() else {
            panic!("missing content in event: {event:?}");
        };
        let Ok(content) = Content::decode(&*serialized_content.content_bytes)
        else {
            panic!("failed to decode event: {event:?}");
        };
        let Some(ContentBody::Post(post)) = content.content_body else {
            panic!("unexpected content body: {event:?}");
        };
        assert_eq!(post, expected);
        // Hard to assert the actual rank, so just check we have it.
        assert!(result.rank >= 0.0);
    }
}
