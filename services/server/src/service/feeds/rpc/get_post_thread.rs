//! `get_post_thread`: ancestors (root → direct parent), the subject
//! itself, then descendants (one branch deep for now).

use crate::data::EventWithContentRow;
use crate::data::hydration::{HydrationState, post_hydrate};
use crate::data::{Cursor, PageInfo, pipeline};
use crate::service::context::RequestContext;
use crate::service::events::TargetEventKey;
use crate::service::feeds::repository::Query as FeedsRepository;
use crate::service::feeds::rpc::common::{
    self as feeds_pipeline, GetFeedResponseFilter, GetFeedResponseView,
};
use crate::service::feeds::util::map_db_err;
use crate::service::proto::{GetPostThreadRequest, GetPostThreadResponse};
use std::collections::HashMap;
use tonic::Status;

const PARENT_HEIGHT_LIMIT: i32 = 50;
const DESCENDANT_DEPTH_LIMIT: i32 = 50;
/// Only one branch per thread for now: at each level we keep the
/// newest child.
const BRANCHING_FACTOR: usize = 1;

pub struct Params {
    pub collection: i16,
    pub identity: String,
    pub public_key_type: i16,
    pub public_key: Vec<u8>,
    pub sequence: i64,
    pub descendants_limit: u64,
    pub omit_labels: Vec<String>,
}

pub async fn handle(
    ctx: &RequestContext<'_>,
    req: GetPostThreadRequest,
) -> Result<GetPostThreadResponse, Status> {
    let descendants_limit = if req.limit <= 0 {
        200
    } else {
        req.limit.min(200) as u64
    };

    let event_key = TargetEventKey::from_request(req.event_key, "event_key")?;

    let params = Params {
        collection: event_key.collection,
        identity: event_key.identity,
        public_key_type: event_key.public_key_type,
        public_key: event_key.public_key,
        sequence: event_key.sequence,
        descendants_limit,
        omit_labels: req.omit_labels,
    };

    let result =
        pipeline::create_pipeline(ctx, &params, fetch, hydrate, filter, view)
            .await?;
    Ok(GetPostThreadResponse {
        thread: result.event_bundles,
        event_hints: result.event_hints,
    })
}

async fn fetch(
    ctx: &RequestContext<'_>,
    params: &Params,
) -> Result<feeds_pipeline::Fetched, Status> {
    let subject_row = FeedsRepository::find_event_by_key(
        &ctx.service.ro_db,
        params.collection,
        &params.identity,
        params.public_key_type,
        params.public_key.clone(),
        params.sequence,
    )
    .await
    .map_err(map_db_err)?
    .ok_or_else(|| Status::not_found("event not found"))?;
    let subject_id = subject_row.0.id;

    let ancestor_refs_fut = async {
        FeedsRepository::list_ancestor_refs(
            &ctx.service.ro_db,
            subject_id,
            PARENT_HEIGHT_LIMIT,
        )
        .await
        .map_err(map_db_err)
    };

    let descendant_refs_fut = async {
        FeedsRepository::list_descendant_refs(
            &ctx.service.ro_db,
            subject_id,
            DESCENDANT_DEPTH_LIMIT,
            params.descendants_limit,
        )
        .await
        .map_err(map_db_err)
    };

    let (ancestor_refs, descendant_refs) =
        tokio::try_join!(ancestor_refs_fut, descendant_refs_fut)?;

    // parent → [children, newest-first]. Order is (depth ASC,
    // created_at DESC), so per-parent order is newest first.
    let mut children_by_parent: HashMap<i64, Vec<i64>> = HashMap::new();
    for r in descendant_refs {
        children_by_parent
            .entry(r.parent_event_id)
            .or_default()
            .push(r.event_id);
    }

    let mut descendant_order: Vec<i64> = Vec::new();
    if let Some(direct) = children_by_parent.get(&subject_id) {
        let mut stack: Vec<i64> = Vec::new();
        for id in direct.iter().rev() {
            stack.push(*id);
        }
        while let Some(id) = stack.pop() {
            descendant_order.push(id);
            if let Some(kids) = children_by_parent.get(&id) {
                let take = kids.len().min(BRANCHING_FACTOR);
                for &kid in kids.iter().take(take).rev() {
                    stack.push(kid);
                }
            }
        }
    }

    let mut all_ids: Vec<i64> =
        Vec::with_capacity(ancestor_refs.len() + descendant_order.len());
    all_ids.extend(ancestor_refs.iter().map(|r| r.event_id));
    all_ids.extend(descendant_order.iter().copied());
    let mut by_id: HashMap<i64, EventWithContentRow> =
        FeedsRepository::list_events_by_ids(&ctx.service.ro_db, all_ids)
            .await
            .map_err(map_db_err)?
            .into_iter()
            .map(|row| (row.0.id, row))
            .collect();

    let mut thread: Vec<EventWithContentRow> =
        Vec::with_capacity(ancestor_refs.len() + 1 + descendant_order.len());
    for r in &ancestor_refs {
        if let Some(row) = by_id.remove(&r.event_id) {
            thread.push(row);
        }
    }
    thread.push(subject_row);
    for id in &descendant_order {
        if let Some(row) = by_id.remove(id) {
            thread.push(row);
        }
    }
    Ok(feeds_pipeline::Fetched {
        rows: thread,
        page_info: PageInfo {
            backward_cursor: Cursor::Start,
            forward_cursor: Cursor::End,
            has_previous_page: false,
            has_next_page: false,
        },
    })
}

async fn hydrate(
    ctx: &RequestContext<'_>,
    _: &Params,
    fetched: &feeds_pipeline::Fetched,
) -> Result<HydrationState, Status> {
    post_hydrate(ctx, &fetched.rows).await
}

async fn filter(
    _: &RequestContext<'_>,
    params: &Params,
    fetched: feeds_pipeline::Fetched,
    hydration: &HydrationState,
) -> Result<GetFeedResponseFilter, Status> {
    feeds_pipeline::filter_thread(fetched, hydration, &params.omit_labels).await
}

async fn view(
    ctx: &RequestContext<'_>,
    _: &Params,
    filtered: GetFeedResponseFilter,
    hydration: HydrationState,
) -> Result<GetFeedResponseView, Status> {
    feeds_pipeline::view(ctx.service, filtered, hydration).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::hydration::HydrationState;
    use crate::service::context::ServiceContext;
    use crate::service::proto::content::ContentBody;
    use crate::service::proto::{
        Content, EventKey, Post, PostReply, PublicKey,
    };
    use ::entity::content_model as ContentModel;
    use ::entity::event_model as EventModel;
    use chrono::DateTime;
    use prost::Message;
    use sea_orm::prelude::DateTimeWithTimeZone;
    use sea_orm::{DbBackend, MockDatabase, MockRow, Value};
    use std::collections::BTreeMap;
    use std::sync::Arc;

    const POST_COLLECTION: i16 = 2;

    fn ts(seconds: i64) -> DateTimeWithTimeZone {
        DateTime::from_timestamp(seconds, 0).unwrap().fixed_offset()
    }

    fn event_row(id: i64, identity: &str) -> EventModel::Model {
        EventModel::Model {
            id,
            collection: POST_COLLECTION,
            identity: identity.to_string(),
            public_key_type: 1,
            public_key: vec![0xaa],
            sequence: id,
            content_digest_type: Some(1),
            content_digest_bytes: Some(vec![id as u8]),
            signature: vec![id as u8],
            previous_signature: vec![],
            previous_root: vec![],
            application_id: None,
            event_bytes: vec![id as u8],
            created_at: ts(id),
            synced_at: ts(id),
        }
    }

    fn event_key_of(row: &EventModel::Model) -> EventKey {
        EventKey {
            collection: row.collection as i32,
            identity: row.identity.clone(),
            signed_by: Some(PublicKey {
                key_type: row.public_key_type as i32,
                key: row.public_key.clone(),
            }),
            sequence: row.sequence as u64,
        }
    }

    fn content_row(id: i64, content: &Content) -> ContentModel::Model {
        ContentModel::Model {
            id,
            digest_type: 1,
            digest_bytes: vec![id as u8],
            serialized_bytes: content.encode_to_vec(),
            synced_at: ts(id),
        }
    }

    fn post_row(
        id: i64,
        identity: &str,
    ) -> (EventModel::Model, ContentModel::Model) {
        let content = Content {
            content_body: Some(ContentBody::Post(Post::default())),
        };
        (event_row(id, identity), content_row(id, &content))
    }

    fn reply_row(
        id: i64,
        identity: &str,
        parent: &EventModel::Model,
    ) -> (EventModel::Model, ContentModel::Model) {
        let parent_key = event_key_of(parent);
        let content = Content {
            content_body: Some(ContentBody::Post(Post {
                reply: Some(PostReply {
                    root: Some(parent_key.clone()),
                    parent: Some(parent_key),
                }),
                ..Default::default()
            })),
        };
        (event_row(id, identity), content_row(id, &content))
    }

    fn descendant_ref_row(
        event_id: i64,
        parent_event_id: i64,
    ) -> BTreeMap<String, Value> {
        BTreeMap::from([
            ("event_id".to_owned(), Value::BigInt(Some(event_id))),
            (
                "parent_event_id".to_owned(),
                Value::BigInt(Some(parent_event_id)),
            ),
        ])
    }

    async fn ctx(db: sea_orm::DatabaseConnection) -> Arc<ServiceContext> {
        let kafka_producer = common_kafka::build_producer()
            .await
            .expect("failed to build Kafka producer");
        ServiceContext::new(db, kafka_producer)
    }

    fn params() -> Params {
        Params {
            collection: POST_COLLECTION,
            identity: "alice".to_string(),
            public_key_type: 1,
            public_key: vec![0xaa],
            sequence: 10,
            descendants_limit: 200,
            omit_labels: Vec::new(),
        }
    }

    /// Hydration whose caller blocks `blocked`.
    fn hydration_blocking(blocked: &[&str]) -> HydrationState {
        HydrationState {
            blocked_identities: Arc::new(
                blocked.iter().map(|s| s.to_string()).collect(),
            ),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn a_blocked_reply_takes_its_descendants_with_it() {
        let alice_subject = post_row(10, "alice");
        let bob_reply = reply_row(11, "bob", &alice_subject.0);
        let charlie_reply = reply_row(12, "charlie", &bob_reply.0);

        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![alice_subject.clone()]])
            .append_query_results([Vec::<MockRow>::new()])
            .append_query_results([vec![
                descendant_ref_row(11, 10),
                descendant_ref_row(12, 11),
            ]])
            .append_query_results([vec![
                bob_reply.clone(),
                charlie_reply.clone(),
            ]])
            .into_connection();
        let ctx = ctx(db).await;

        let ctx = RequestContext::new(&ctx, Some("caller"));

        let fetched = fetch(&ctx, &params()).await.unwrap();
        let fetched_identities: Vec<&str> = fetched
            .rows
            .iter()
            .map(|(event, _)| event.identity.as_str())
            .collect();
        assert_eq!(fetched_identities, ["alice", "bob", "charlie"]);

        let hydration = hydration_blocking(&["bob"]);
        let filtered = feeds_pipeline::filter_thread(fetched, &hydration, &[])
            .await
            .unwrap();
        let live_identities: Vec<&str> = filtered
            .live_rows
            .iter()
            .map(|(event, _)| event.identity.as_str())
            .collect();
        assert_eq!(live_identities, ["alice"]);
    }
}
