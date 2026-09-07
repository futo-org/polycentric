pub mod key;
pub mod labels;
pub mod merge;

use std::sync::{Arc, Mutex};

use polycentric_common::models::protos_v2;
use polycentric_common::models::protos_v2::{
    EventBundle, EventHint, ListEventsFilters, ListEventsRequest, ListEventsResponse,
    event_sync_service_client::EventSyncServiceClient,
};
use prost::Message;

use crate::client::PolycentricClient;
use crate::lock::LockRecover;
use crate::query::event::key::{EventKey, PublicKey};
use crate::query::event::merge::{EventBundleResponse, merge_bundle_responses};
use crate::query::{
    QueryClient, QueryKey, QueryObservable, QueryOpts, QueryResult, QueryStatus, channel,
};
use crate::rx::observable::Observable;

#[derive(Clone, Debug, uniffi::Record)]
pub struct ListEventsArgs {
    pub size: Option<i32>,
    pub identity: Option<String>,
    pub collection: Option<i32>,
    pub signed_by: Option<PublicKey>,
    pub sequence_gt: Option<i64>,
    pub sequence_lt: Option<i64>,
    pub heads: Option<Vec<EventKey>>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct GetEventArgs {
    pub identity: String,
    pub collection: i32,
    pub sequence: u64,
    pub signer_key_prefix: Option<String>,
}

impl EventBundleResponse for ListEventsResponse {
    fn bundles_mut(&mut self) -> &mut Vec<EventBundle> {
        &mut self.event_bundles
    }
    fn hints_mut(&mut self) -> &mut Vec<EventHint> {
        &mut self.event_hints
    }
}

/// Returns serialized `ListEventsResponse` proto bytes on each emission with
/// `event_bundles` deduped by `EventKey`.
pub fn list_events(
    query_client: &QueryClient<Vec<u8>>,
    query_key: Option<QueryKey>,
    args: ListEventsArgs,
    opts: Option<QueryOpts>,
) -> Arc<dyn QueryObservable> {
    let ListEventsArgs {
        size,
        identity,
        collection,
        signed_by,
        sequence_gt,
        sequence_lt,
        heads,
    } = args;

    let heads = heads
        .unwrap_or_default()
        .into_iter()
        .map(
            |EventKey {
                 collection,
                 identity,
                 signed_by,
                 sequence,
             }| {
                let PublicKey { key_type, key } = signed_by;
                protos_v2::EventKey {
                    collection,
                    identity,
                    signed_by: Some(protos_v2::PublicKey { key_type, key }),
                    sequence,
                }
            },
        )
        .collect();

    let request = ListEventsRequest {
        filters: Some(ListEventsFilters {
            collection,
            identity,
            signed_by: signed_by.map(Into::into),
            sequence_gt,
            sequence_lt,
            heads,
        }),
        size,
    };

    let client = query_client.client().clone();
    let query_fn = move |server_url: String| {
        let request = request.clone();
        let client = client.clone();
        async move {
            let response = EventSyncServiceClient::new(channel(&server_url).await?)
                .list_events(request)
                .await
                .map_err(|e| format!("list_events [{server_url}]: {e}"))?
                .into_inner();
            let bytes = response.encode_to_vec();
            let hint_bundles: Vec<_> = response
                .event_hints
                .into_iter()
                .filter_map(|h| h.event_bundle)
                .collect();
            {
                let mut c = client.lock_recover();
                c.copy_bundles(hint_bundles);
                c.copy_bundles(response.event_bundles);
            }
            Ok(bytes)
        }
    };

    Arc::new(query_client.fetch(
        query_key,
        query_fn,
        merge_bundle_responses::<ListEventsResponse>,
        opts,
    ))
}

/// Return a single event based on its key (or partial key)
pub fn get_event(
    query_client: &QueryClient<Vec<u8>>,
    query_key: Option<QueryKey>,
    args: GetEventArgs,
    opts: Option<QueryOpts>,
) -> Arc<dyn QueryObservable> {
    let GetEventArgs {
        identity,
        collection,
        sequence,
        signer_key_prefix,
    } = args;
    let signer_key_prefix = Arc::new(signer_key_prefix);

    if let Some(bundle) = query_client
        .client()
        .lock_recover()
        .find_event_bundle_by_sequence(
            &identity,
            collection,
            sequence,
            signer_key_prefix.as_deref(),
        )
    {
        let bytes = bundle.encode_to_vec();
        let observable: Observable<QueryResult<Vec<u8>>> = Observable::new(move |subscriber| {
            subscriber.next(QueryResult {
                data: Some(bytes.clone()),
                status: QueryStatus::Success,
                successful_servers: 0,
                pending_servers: 0,
            });
            subscriber.complete();
        });
        return Arc::new(observable);
    }

    let sequence_i64 = sequence as i64;
    let request = ListEventsRequest {
        filters: Some(ListEventsFilters {
            collection: Some(collection),
            identity: Some(identity.clone()),
            signed_by: None,
            sequence_gt: Some(sequence_i64.saturating_sub(1)),
            sequence_lt: Some(sequence_i64.saturating_add(1)),
            heads: vec![],
        }),
        size: None,
    };

    let client = query_client.client().clone();

    // The query function will copy event bundles and hints into the local store,
    // so we can rely on the local store to handle tombstones properly.
    let merge_fn = {
        let identity = identity.clone();
        let signer_key_prefix = signer_key_prefix.clone();

        move |_values: &[Vec<u8>],
              _previous: Option<&Vec<u8>>,
              client: &Arc<Mutex<PolycentricClient>>| {
            let bundle = client.clone().lock_recover().find_event_bundle_by_sequence(
                &identity,
                collection,
                sequence,
                signer_key_prefix.as_deref(),
            );

            bundle
                .as_ref()
                .map(EventBundle::encode_to_vec)
                .unwrap_or_default()
        }
    };

    let query_fn = move |server_url: String| {
        let request = request.clone();
        let identity = identity.clone();
        let client = client.clone();
        let signer_key_prefix = signer_key_prefix.clone();

        async move {
            let response = EventSyncServiceClient::new(channel(&server_url).await?)
                .list_events(request)
                .await
                .map_err(|e| format!("get_event [{server_url}]: {e}"))?
                .into_inner();

            let hint_bundles: Vec<_> = response
                .event_hints
                .into_iter()
                .filter_map(|h| h.event_bundle)
                .collect();

            // Copy events and content to local stores so that we can rely on
            // the client to handle tombstone checking logic
            let bundle = {
                let mut c = client.lock_recover();
                c.copy_bundles(hint_bundles);
                c.copy_bundles(response.event_bundles);
                c.find_event_bundle_by_sequence(
                    &identity,
                    collection,
                    sequence,
                    signer_key_prefix.as_deref(),
                )
            };

            let bytes = bundle
                .as_ref()
                .map(EventBundle::encode_to_vec)
                .unwrap_or_default();

            Ok(bytes)
        }
    };

    Arc::new(query_client.fetch(query_key, query_fn, merge_fn, opts))
}
