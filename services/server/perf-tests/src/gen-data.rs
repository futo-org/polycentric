use std::cmp::{max, min};
use std::process::exit;
use std::time::Instant;
use std::{env, panic};

use ed25519_dalek::SigningKey;
use perf_tests::{
    Client, current_timestamp, optional_random_string, public_key_of,
    random_string, random_strings,
};
use polycentric_common::models::protos_v2::{
    EventKey, Identity, Post, PostReply, ProfileUpdate, ReportCategory,
};
use tokio::task::JoinSet;

const MAX_EVENTS_PER_REQUEST: usize = 100;

#[tokio::main]
async fn main() {
    let mut args = env::args();
    args.next(); // Binary name.
    let Some(address) = args.next() else {
        eprintln!("Missing address argument");
        exit(1);
    };

    if args.len() == 0 {
        eprintln!("No events to generate (maybe missing address?).");
        exit(1);
    }

    let mut amount = 100;
    let mut clients = 1;
    let mut to_generate = Vec::new();
    let mut needs_identities = false;
    let mut needs_posts = false;
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
                    .expect("missing amount of clients")
                    .parse()
                    .expect("invalid amount of clients");
                continue;
            }
            "post" => EventKind::Post(GenReply::None),
            "post-reply-chain" => EventKind::Post(GenReply::Chain),
            "post-reply-to-one" => EventKind::Post(GenReply::ToOne),
            "delete" => EventKind::Delete,
            "follow" => {
                needs_identities = true;
                EventKind::Follow
            }
            "block" => {
                needs_identities = true;
                EventKind::Block
            }
            "reaction" => {
                needs_posts = true;
                EventKind::Reaction
            }
            "profile" | "profile_update" | "profile-update" => {
                EventKind::ProfileUpdate
            }
            "identity" => EventKind::Identity,
            "repost" => {
                needs_posts = true;
                EventKind::Repost
            }
            "report" => {
                needs_posts = true;
                EventKind::Report
            }
            "labels" => {
                needs_posts = true;
                EventKind::Labels
            }
            arg => panic!("unexpect data to generate '{arg}'"),
        };
        to_generate.push(method);
    }
    let amount_per_client = amount / clients;

    let identities = if needs_identities {
        create_identities(address.clone(), clients, amount_per_client).await
    } else {
        Box::from([])
    };

    let posts = if needs_posts {
        create_posts(address.clone(), clients, amount_per_client).await
    } else {
        Box::from([])
    };

    let start = Instant::now();
    println!("Connecting to {address}");
    let mut set = JoinSet::new();
    for kind in to_generate {
        println!(
            "Generating {amount} {kind:?} events using {clients} clients..."
        );
        for _ in 0..clients {
            set.spawn(gen_data(
                address.clone(),
                kind,
                amount_per_client,
                identities.clone(),
                posts.clone(),
            ));
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

    println!("Generated all events in {:?}", start.elapsed());
}

async fn create_identities(
    address: String,
    clients: usize,
    amount: usize,
) -> Box<[Box<str>]> {
    let mut set = JoinSet::new();
    let clients = max(min(clients, 10), 1);
    let amount_per = amount / clients;
    let mut left = amount % clients;
    for _ in 0..clients {
        let amount = amount_per + left;
        left = 0;
        let address = address.clone();
        set.spawn(async move {
            let mut ids = Vec::with_capacity(amount);
            for _ in 0..amount {
                let mut client = Client::new(address.clone()).await;
                client.submit_events().await;
                ids.push(client.identity().into())
            }
            ids
        });
    }
    let mut identities = Vec::with_capacity(amount);
    while let Some(res) = set.join_next().await {
        match res {
            Ok(ids) => identities.extend(ids),
            Err(err) if err.is_panic() => {
                panic::resume_unwind(err.into_panic())
            }
            Err(err) => panic!("{err}"),
        }
    }
    identities.into_boxed_slice()
}

async fn create_posts(
    address: String,
    clients: usize,
    amount: usize,
) -> Box<[EventKey]> {
    let mut set = JoinSet::new();
    let clients = max(min(clients, 10), 1);
    let amount_per = amount / clients;
    let mut left = amount % clients;
    for _ in 0..clients {
        let amount = amount_per + left;
        left = 0;
        let address = address.clone();
        set.spawn(async move {
            let mut posts = Vec::with_capacity(amount);
            let mut client = Client::new(address.clone()).await;
            for _ in 0..amount {
                client.post_text(&random_string(10, 300), current_timestamp());
                let event_key = client.get_last_event_key();
                posts.push(event_key);
            }
            client.submit_events().await;
            posts
        });
    }
    let mut posts = Vec::with_capacity(amount);
    while let Some(res) = set.join_next().await {
        match res {
            Ok(p) => posts.extend(p),
            Err(err) if err.is_panic() => {
                panic::resume_unwind(err.into_panic())
            }
            Err(err) => panic!("{err}"),
        }
    }
    posts.into_boxed_slice()
}

/// Matches ContentBody variants.
#[derive(Copy, Clone, Debug)]
enum EventKind {
    Post(GenReply),
    Delete,
    Follow,
    Block,
    Reaction,
    /*
    AttributedToReaction,
    */
    ProfileUpdate,
    Identity,
    Repost,
    Report,
    Labels,
    /*
    VerificationClaim,
    VerificationVerify,
    VerificationTarget,
    */
}

async fn gen_data(
    address: String,
    kind: EventKind,
    amount: usize,
    identities: Box<[Box<str>]>,
    posts: Box<[EventKey]>,
) {
    let client = Client::new(address).await;
    match kind {
        EventKind::Post(reply) => gen_post(client, amount, reply).await,
        EventKind::Delete => gen_delete(client, amount).await,
        EventKind::Follow => gen_follow(client, amount, identities).await,
        EventKind::Block => gen_block(client, amount, identities).await,
        EventKind::Reaction => gen_reaction(client, amount, posts).await,
        EventKind::ProfileUpdate => gen_profile_update(client, amount).await,
        EventKind::Identity => gen_identity(client, amount).await,
        EventKind::Repost => gen_repost(client, amount, posts).await,
        EventKind::Report => gen_report(client, amount, posts).await,
        EventKind::Labels => gen_labels(client, amount, posts).await,
    }
}

#[derive(Copy, Clone, Debug)]
enum GenReply {
    /// No replies.
    None,
    /// Make one large chain always replying to the previously made post.
    Chain,
    /// Always reply to the first made post.
    ToOne,
}

async fn gen_post(mut client: Client, amount: usize, reply: GenReply) {
    let mut root: Option<EventKey> = None;
    let mut last: Option<EventKey> = None;
    for _ in 0..amount {
        client.post(
            Post {
                text: random_string(10, 1000),
                reply: match reply {
                    GenReply::None => None,
                    GenReply::Chain | GenReply::ToOne => Some(PostReply {
                        root: root.clone(),
                        parent: last.clone(),
                    }),
                },
                images: Vec::new(), // Vec<ImageSet>,
                quote: if let Some(last) = last.as_ref()
                    && rand::random()
                {
                    Some(last.clone())
                } else {
                    None
                },
                links: Vec::new(), // Vec<Link>,
                labels: random_strings(
                    /* amount. */ 0, 10, /* label length*/ 3, 30,
                ),
                attributed_to: Vec::new(), // Vec<AttributedTo>,
            },
            current_timestamp(),
        );
        if let GenReply::Chain = reply {
            if root.is_none() {
                root = Some(client.get_last_event_key());
            }
            last = Some(client.get_last_event_key());
        } else if let GenReply::ToOne = reply {
            if root.is_none() {
                root = Some(client.get_last_event_key());
                last = Some(client.get_last_event_key());
            }
        }

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_delete(mut client: Client, amount: usize) {
    for _ in 0..amount {
        client.post(
            Post {
                text: random_string(10, 1000),
                reply: None,
                images: Vec::new(),
                quote: None,
                links: Vec::new(),
                labels: Vec::new(),
                attributed_to: Vec::new(),
            },
            current_timestamp(),
        );
        let event_key = client.get_last_event_key();
        client.delete_key(event_key, current_timestamp());

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_follow(
    mut client: Client,
    amount: usize,
    identities: Box<[Box<str>]>,
) {
    assert!(identities.len() >= amount);
    for identity in identities {
        client.follow_identity(identity.into(), current_timestamp());

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_block(
    mut client: Client,
    amount: usize,
    identities: Box<[Box<str>]>,
) {
    assert!(identities.len() >= amount);
    for identity in identities {
        client.block_identity(identity.into(), current_timestamp());

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_reaction(
    mut client: Client,
    amount: usize,
    posts: Box<[EventKey]>,
) {
    assert!(posts.len() >= amount);
    for post in posts {
        client.thumbs_up(post, current_timestamp());

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_identity(mut client: Client, amount: usize) {
    for _ in 0..amount {
        let key = SigningKey::from_bytes(&rand::random());
        let identity = Identity {
            rotation_keys: vec![public_key_of(&key)],
            signing_keys: vec![],
            revocation_bounds: vec![],
            servers: None,
            recovery_key: None,
            recovery_signature: None,
        };
        client.set_identity(identity, current_timestamp());

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_repost(mut client: Client, amount: usize, posts: Box<[EventKey]>) {
    assert!(posts.len() >= amount);
    for post in posts {
        client.repost_key(post, current_timestamp());

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_report(mut client: Client, amount: usize, posts: Box<[EventKey]>) {
    assert!(posts.len() >= amount);
    for post in posts {
        client.report_key(
            post,
            ReportCategory::Unspecified,
            current_timestamp(),
        );

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_labels(mut client: Client, amount: usize, posts: Box<[EventKey]>) {
    assert!(posts.len() >= amount);
    for post in posts {
        client.add_labels(
            post,
            random_strings(1, 5, 5, 20),
            current_timestamp(),
        );

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}

async fn gen_profile_update(mut client: Client, amount: usize) {
    for _ in 0..amount {
        client.profile_update(
            ProfileUpdate {
                name: optional_random_string(5, 100),
                avatar: None, // Option<ImageSet>,
                banner: None, // Option<ImageSet>,
                description: optional_random_string(10, 500),
                alias: optional_random_string(3, 20),
            },
            current_timestamp(),
        );

        if client.pending().len() > MAX_EVENTS_PER_REQUEST {
            client.submit_events().await
        }
    }
    client.submit_events().await
}
