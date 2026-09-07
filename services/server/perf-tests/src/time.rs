use std::process::exit;
use std::time::{Duration, Instant};
use std::{env, panic};

use polycentric_common::models::protos_v2::event_sync_service_client::EventSyncServiceClient;
use polycentric_common::models::protos_v2::feeds_service_client::FeedsServiceClient;
use polycentric_common::models::protos_v2::graph_service_client::GraphServiceClient;
use polycentric_common::models::protos_v2::{
    EventKey, GetExploreFeedRequest, GetFollowingFeedRequest,
    GetIdentityFeedRequest, GetPostThreadRequest, GetReactionsRequest,
    ListEventsRequest, ListFollowersRequest, ListFollowingRequest,
    ListHeadsRequest, PublicKey, SortPostsBy, SuggestFollowRequest,
};
use tokio::task::JoinSet;

#[tokio::main]
async fn main() {
    let mut args = env::args();
    args.next(); // Binary name.
    let Some(address) = args.next() else {
        eprintln!("Missing address argument");
        exit(1);
    };

    let mut amount = 100;
    let mut clients = 1;
    let mut methods = Vec::new();
    while let Some(arg) = args.next() {
        let method = match arg.as_str() {
            "--amount" => {
                amount = args
                    .next()
                    .expect("missing amount")
                    .parse()
                    .expect("invalid amount");
                continue;
            }
            "--clients" => {
                clients = args
                    .next()
                    .expect("missing clients")
                    .parse()
                    .expect("invalid amount of clients");
                continue;
            }
            "GetIdentityFeed" => {
                let identity =
                    args.next().expect("missing identity for GetIdentityFeed");
                RpcMethod::GetIdentityFeed(identity)
            }
            "GetFollowingFeed" => {
                let identity =
                    args.next().expect("missing identity for GetFollowingFeed");
                RpcMethod::GetFollowingFeed(identity)
            }
            "GetRecommendedFeed" => {
                let identity = args
                    .next()
                    .expect("missing identity for GetRecommendedFeed");
                RpcMethod::GetRecommendedFeed(identity)
            }
            "GetExploreFeed" => RpcMethod::GetExploreFeed,
            "GetPostThread" => {
                let event_key = read_event_key(
                    args.next().expect("missing event key for GetPostThread"),
                );
                RpcMethod::GetPostThread(event_key)
            }
            "GetAttributionFeed" => RpcMethod::GetAttributionFeed,
            "ListFollowing" => {
                let identity =
                    args.next().expect("missing identity for ListFollowing");
                RpcMethod::ListFollowing(identity)
            }
            "ListFollowers" => {
                let identity =
                    args.next().expect("missing identity for ListFollowers");
                RpcMethod::ListFollowers(identity)
            }
            "SuggestFollow" => {
                let identity =
                    args.next().expect("missing identity for SuggestFollow");
                RpcMethod::SuggestFollow(identity)
            }
            "ListEvents" => RpcMethod::ListEvents,
            "ListHeads" => {
                let identity =
                    args.next().expect("missing identity for ListHeads");
                RpcMethod::ListHeads(identity)
            }
            "GetReactions" => {
                let event_key = read_event_key(
                    args.next().expect("missing event key for GetReactions"),
                );
                RpcMethod::GetReactions(event_key)
            }
            arg => panic!("unknown option/rpc method '{arg}'"),
        };
        methods.push(method);
    }

    if methods.is_empty() {
        eprintln!("No rpc methods to time (maybe missing address?).");
        exit(1);
    }

    let start = Instant::now();
    println!("Connecting to {address}");
    let mut set = JoinSet::new();
    for method in methods {
        println!("Timing {method:?} {amount} times using {clients} clients...");
        let amount_per = amount / clients;
        for _ in 0..clients {
            set.spawn(time(address.clone(), method.clone(), amount_per));
        }
    }

    while let Some(res) = set.join_next().await {
        match res {
            Ok(()) => {}
            Err(err) if err.is_panic() => {
                panic::resume_unwind(err.into_panic())
            }
            Err(err) => panic!("Unexpected error: {err}"),
        }
    }

    println!("All methods took {:?}", start.elapsed());
}

/// Reads an event key in JSON format.
///
/// To obtain this from the database you can use the following query:
/// ```sql
/// WITH event AS (
///     SELECT collection, identity, public_key_type, public_key, sequence
///     FROM events
///     WHERE id = $1 -- TODO: set event id.
/// )
/// SELECT '''' || row_to_json(event.*)::TEXT || ''''
/// FROM event;
/// ```
///
/// For example:
///
/// ```json
/// {
///   "collection": 2,
///   "identity": "14acd25ed3c647a45fc4f5d40fffc7236496cfe0fa50e53cb20b3ff0bbe9be12",
///   "public_key_type": 1,
///   "public_key": "\\x9b723d1cfc4f921c3d136c21419acc07d264498602b9a5e6552c6efb96187ed8",
///   "sequence": 1
/// }
/// ```
fn read_event_key(arg: String) -> EventKey {
    let value: serde_json::Value =
        serde_json::from_str(&arg).expect("failed to parse event key as JSON");
    EventKey {
        collection: value.get("collection").unwrap().as_i64().unwrap() as _,
        identity: value.get("identity").unwrap().as_str().unwrap().to_owned(),
        signed_by: Some(PublicKey {
            key_type: value.get("public_key_type").unwrap().as_i64().unwrap()
                as _,
            key: {
                let mut val =
                    value.get("public_key").unwrap().as_str().unwrap();
                // Postgres starts hexes \\
                if val.starts_with("\\") {
                    val = &val[2..];
                }
                hex::decode(val).unwrap()
            },
        }),
        sequence: value.get("sequence").unwrap().as_i64().unwrap() as _,
    }
}

/// Matches ContentBody variants.
#[derive(Clone, Debug)]
enum RpcMethod {
    // FeedsService
    GetIdentityFeed(String),
    GetFollowingFeed(String),
    GetRecommendedFeed(String),
    GetExploreFeed,
    GetPostThread(EventKey),
    GetAttributionFeed,
    ListFollowing(String),
    ListFollowers(String),
    SuggestFollow(String),
    ListEvents,
    ListHeads(String),
    GetReactions(EventKey),
}

async fn time(address: String, method: RpcMethod, amount: usize) {
    match method {
        RpcMethod::GetIdentityFeed(identity) => {
            time_get_idenitity_feed(address, amount, identity).await
        }
        RpcMethod::GetFollowingFeed(follower_identity) => {
            time_following_feed(address, amount, follower_identity).await
        }
        RpcMethod::GetRecommendedFeed(follower_identity) => {
            time_recommended_feed(address, amount, follower_identity).await
        }
        RpcMethod::GetExploreFeed => time_explore_feed(address, amount).await,
        RpcMethod::GetPostThread(event_key) => {
            time_post_thread(address, amount, event_key).await
        }
        RpcMethod::ListFollowing(identity) => {
            time_list_following(address, amount, identity).await
        }
        RpcMethod::ListFollowers(identity) => {
            time_list_followers(address, amount, identity).await
        }
        RpcMethod::SuggestFollow(identity) => {
            time_suggest_follow(address, amount, identity).await
        }
        RpcMethod::ListEvents => time_list_events(address, amount).await,
        RpcMethod::ListHeads(identity) => {
            time_list_heads(address, amount, identity).await
        }
        RpcMethod::GetReactions(event_key) => {
            time_get_reactions(address, amount, event_key).await
        }
        method => todo!("unsupported rpc method {method:?}"),
    }
}

async fn time_get_idenitity_feed(
    address: String,
    amount: usize,
    identity: String,
) {
    let mut client = feeds_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = GetIdentityFeedRequest {
            identity: identity.to_owned(),
            page_params: None,
            omit_labels: Vec::new(),
        };
        let start = Instant::now();
        client.get_identity_feed(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_following_feed(
    address: String,
    amount: usize,
    follower_identity: String,
) {
    let mut client = feeds_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = GetFollowingFeedRequest {
            follower_identity: follower_identity.clone(),
            page_params: None,
            omit_labels: Vec::new(),
            sort_by: Some(SortPostsBy::Top as i32),
        };
        let start = Instant::now();
        client.get_following_feed(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_recommended_feed(
    address: String,
    amount: usize,
    follower_identity: String,
) {
    let mut client = feeds_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = GetFollowingFeedRequest {
            follower_identity: follower_identity.clone(),
            page_params: None,
            omit_labels: Vec::new(),
            sort_by: Some(SortPostsBy::Top as i32),
        };
        let start = Instant::now();
        client.get_recommended_feed(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_explore_feed(address: String, amount: usize) {
    let mut client = feeds_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = GetExploreFeedRequest {
            identity: None,
            page_params: None,
            omit_labels: Vec::new(),
            sort_by: Some(SortPostsBy::Top as i32),
        };
        let start = Instant::now();
        client.get_explore_feed(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_post_thread(address: String, amount: usize, event_key: EventKey) {
    let mut client = feeds_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = GetPostThreadRequest {
            event_key: Some(event_key.clone()),
            limit: 999999999,
            omit_labels: Vec::new(),
        };
        let start = Instant::now();
        client.get_post_thread(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_list_following(address: String, amount: usize, identity: String) {
    let mut client = graph_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = ListFollowingRequest {
            identity: identity.clone(),
            page_params: None,
        };
        let start = Instant::now();
        client.list_following(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_list_followers(address: String, amount: usize, identity: String) {
    let mut client = graph_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = ListFollowersRequest {
            identity: identity.clone(),
            page_params: None,
        };
        let start = Instant::now();
        client.list_followers(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_suggest_follow(address: String, amount: usize, identity: String) {
    let mut client = graph_client(address).await;
    todo!("add auth token for identity");
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = SuggestFollowRequest { page_params: None };
        let start = Instant::now();
        client.suggest_follow(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_list_events(address: String, amount: usize) {
    let mut client = event_sync_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = ListEventsRequest {
            filters: None,
            size: None,
        };
        let start = Instant::now();
        client.list_events(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_list_heads(address: String, amount: usize, identity: String) {
    let mut client = event_sync_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = ListHeadsRequest {
            identity: identity.clone(),
        };
        let start = Instant::now();
        client.list_heads(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn time_get_reactions(
    address: String,
    amount: usize,
    event_key: EventKey,
) {
    let mut client = event_sync_client(address).await;
    let mut total = Duration::ZERO;
    for _ in 0..amount {
        let request = GetReactionsRequest {
            target: Some(event_key.clone()),
            emoji_filter: None,
            page_params: None,
        };
        let start = Instant::now();
        client.get_reactions(request).await.unwrap();
        total += start.elapsed();
    }
    let avg = total / amount as u32;
    println!("{amount} requests took {total:?}, {avg:?} on average");
}

async fn feeds_client(
    address: String,
) -> FeedsServiceClient<tonic::transport::Channel> {
    FeedsServiceClient::connect(address)
        .await
        .expect("failed to connect")
}

async fn graph_client(
    address: String,
) -> GraphServiceClient<tonic::transport::Channel> {
    GraphServiceClient::connect(address)
        .await
        .expect("failed to connect")
}

async fn event_sync_client(
    address: String,
) -> EventSyncServiceClient<tonic::transport::Channel> {
    EventSyncServiceClient::connect(address)
        .await
        .expect("failed to connect")
}
