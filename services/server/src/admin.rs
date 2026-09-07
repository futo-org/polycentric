//! Operator commands. Without `--yes` they only report what would change.

use crate::db::client::build_db_clients;
use crate::service::content::content_filestore::{
    ContentFilestore, ContentFilestoreConfig,
};
use crate::service::identity::repository::{Erased, Query};
use crate::service::identity::service as identity_service;
use sea_orm::DatabaseConnection;

pub const USAGE: &str = "usage: server delete-events (--identity <hex> | --public-key <hex>) [--yes]
       server prune-content [--yes]";

pub async fn delete_events(args: Vec<String>) {
    let mut identity = None;
    let mut public_key = None;
    let mut yes = false;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--identity" => identity = args.next(),
            "--public-key" => public_key = args.next(),
            "--yes" => yes = true,
            _ => usage_error(&format!("unexpected argument: {arg}")),
        }
    }
    let db = connect().await;
    let identities = match (identity, public_key) {
        (Some(identity), None) => vec![identity],
        (None, Some(key)) => {
            let key = hex::decode(key)
                .unwrap_or_else(|_| usage_error("--public-key must be hex"));
            Query::identities_signed_by(&db, &key)
                .await
                .expect("failed to find identities")
        }
        _ => usage_error("pass exactly one of --identity or --public-key"),
    };

    let mut count = 0;
    for identity in &identities {
        count += Query::count_events(&db, identity)
            .await
            .expect("failed to count events");
    }
    if !yes {
        println!(
            "{count} events across {} identities would be deleted; add --yes to delete them",
            identities.len()
        );
        return;
    }

    let filestore = filestore().await;
    let mut total = Erased::default();
    for identity in &identities {
        let erased = identity_service::erase_identity(
            &db,
            filestore.as_ref(),
            None,
            identity,
        )
        .await
        .expect("failed to delete events");
        total.events += erased.events;
        total.content += erased.content;
        total.blobs += erased.blobs;
    }
    println!(
        "deleted {} events, {} orphaned content rows and {} blobs across {} identities",
        total.events,
        total.content,
        total.blobs,
        identities.len()
    );
}

pub async fn prune_content(args: Vec<String>) {
    let yes = match args.as_slice() {
        [] => false,
        [flag] if flag == "--yes" => true,
        _ => usage_error("unexpected arguments"),
    };

    let db = connect().await;
    if !yes {
        let count = Query::count_orphan_content(&db)
            .await
            .expect("failed to count orphaned content");
        println!(
            "{count} content rows would be deleted; add --yes to delete them"
        );
        return;
    }

    let filestore = filestore().await;
    let pruned = identity_service::prune_content(&db, filestore.as_ref())
        .await
        .expect("failed to prune content");
    println!(
        "deleted {} orphaned content rows and {} blobs",
        pruned.content, pruned.blobs
    );
}

async fn connect() -> DatabaseConnection {
    build_db_clients(true)
        .await
        .expect("failed to connect to database")
        .0
}

async fn filestore() -> Option<ContentFilestore> {
    match ContentFilestoreConfig::from_env() {
        Ok(cfg) => Some(ContentFilestore::new(cfg).await),
        Err(error) => {
            eprintln!("object store not configured, leaving blobs: {error}");
            None
        }
    }
}

fn usage_error(message: &str) -> ! {
    eprintln!("{message}\n{USAGE}");
    std::process::exit(2);
}
