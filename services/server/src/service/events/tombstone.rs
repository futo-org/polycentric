use crate::data::EventWithContentRow;
use crate::service::context::ServiceContext;
use crate::service::identity::service::authorize_event_signer;
use crate::service::proto::{
    Event, EventBundle, SerializedContent, SignedEvent,
};
use ::entity::content_delete_model as ContentDeleteModel;
use ::entity::content_model as ContentModel;
use ::entity::event_model as EventModel;
use prost::Message;
use sea_orm::sea_query::{Expr, ExprTrait, IntoCondition};
use sea_orm::{
    ColumnTrait, Condition, DbConn, DbErr, DerivePartialModel, EntityTrait,
    JoinType, QueryFilter, QuerySelect, RelationDef,
};
use std::collections::{HashMap, HashSet};
use tonic::{Code, Status};

use super::TargetEventKey;

/// A row wrapping an event that a Delete tombstone can remove.
pub trait HasEventKey {
    fn event_key(&self) -> TargetEventKey;
}

impl HasEventKey for EventWithContentRow {
    fn event_key(&self) -> TargetEventKey {
        TargetEventKey::of(&self.0)
    }
}

/// The valid Delete tombstones for `keys`, by tombstoned event key.
pub async fn validated_tombstones(
    ctx: &ServiceContext,
    keys: &[TargetEventKey],
) -> Result<HashMap<TargetEventKey, Vec<EventBundle>>, Status> {
    let raw = list_tombstones_for_event_keys(&ctx.ro_db, keys)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "tombstone db error");
            Status::internal("internal server error")
        })?;
    validate_tombstones(ctx, raw).await
}

/// The subset of `keys` whose events have a valid Delete tombstone.
pub async fn tombstoned_keys(
    ctx: &ServiceContext,
    keys: &[TargetEventKey],
) -> Result<HashSet<TargetEventKey>, Status> {
    Ok(validated_tombstones(ctx, keys).await?.into_keys().collect())
}

/// List all tombstone events
/// WARNING: These events are unvalidated and can not be trusted
pub async fn list_tombstones_for_event_keys(
    db: &DbConn,
    keys: &[TargetEventKey],
) -> Result<HashMap<TargetEventKey, Vec<EventBundle>>, DbErr> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }

    let mut filter = Condition::any();
    for key in keys {
        filter = filter.add(
            Condition::all()
                .add(
                    ContentDeleteModel::Column::EventKeyCollection
                        .eq(key.collection),
                )
                .add(
                    ContentDeleteModel::Column::EventKeyIdentity
                        .eq(key.identity.clone()),
                )
                .add(
                    ContentDeleteModel::Column::EventKeyPublicKeyType
                        .eq(key.public_key_type),
                )
                .add(
                    ContentDeleteModel::Column::EventKeyPublicKey
                        .eq(key.public_key.clone()),
                )
                .add(
                    ContentDeleteModel::Column::EventKeySequence
                        .eq(key.sequence),
                ),
        );
    }

    let rows = ContentDeleteModel::Entity::find()
        .join(JoinType::InnerJoin, delete_to_content_join())
        .join(JoinType::InnerJoin, content_to_delete_event_join())
        .filter(filter)
        // Exclude invalid delete events (event not belonging to an identity)
        .filter(
            Expr::col((EventModel::Entity, EventModel::Column::Identity))
                .equals((
                    ContentDeleteModel::Entity,
                    ContentDeleteModel::Column::EventKeyIdentity,
                )),
        )
        .into_partial_model::<TombstoneRow>()
        .all(db)
        .await?;

    let mut by_target: HashMap<TargetEventKey, Vec<EventBundle>> =
        HashMap::new();
    for row in rows {
        let key = TargetEventKey {
            collection: row.event_key_collection,
            identity: row.event_key_identity,
            public_key_type: row.event_key_public_key_type,
            public_key: row.event_key_public_key,
            sequence: row.event_key_sequence,
        };
        by_target.entry(key).or_default().push(EventBundle {
            signed_event: Some(SignedEvent {
                event_bytes: row.delete_event.event_bytes,
                signature: row.delete_event.signature,
            }),
            serialized_content: Some(SerializedContent {
                content_bytes: row.delete_content.serialized_bytes,
            }),
            event_proofs: Vec::new(),
            meta: None,
        });
    }

    Ok(by_target)
}

#[derive(Debug, DerivePartialModel)]
#[sea_orm(entity = "ContentDeleteModel::Entity")]
struct TombstoneRow {
    event_key_collection: i16,
    event_key_identity: String,
    event_key_public_key_type: i16,
    event_key_public_key: Vec<u8>,
    event_key_sequence: i64,

    #[sea_orm(nested)]
    delete_content: TombstoneContentPartial,

    #[sea_orm(nested)]
    delete_event: TombstoneEventPartial,
}

#[derive(Debug, DerivePartialModel)]
#[sea_orm(entity = "ContentModel::Entity")]
struct TombstoneContentPartial {
    serialized_bytes: Vec<u8>,
}

#[derive(Debug, DerivePartialModel)]
#[sea_orm(entity = "EventModel::Entity")]
struct TombstoneEventPartial {
    event_bytes: Vec<u8>,
    signature: Vec<u8>,
}

/// `content_delete → content` on `content_delete.content_id`. The
/// content row reached here is the Delete payload's serialized body —
/// the bytes a client needs to interpret the tombstone.
fn delete_to_content_join() -> RelationDef {
    ContentDeleteModel::Entity::belongs_to(ContentModel::Entity)
        .from(ContentDeleteModel::Column::ContentId)
        .to(ContentModel::Column::Id)
        .into()
}

/// `content → events` on the content digest tuple — finds the signed
/// Delete event whose `content_digest_*` matches the joined-content
/// row. No alias needed: in this query neither table is joined twice.
///
/// `belongs_to` here only assembles the [`RelationDef`] with the
/// from→to columns; semantic direction is irrelevant for an INNER
/// JOIN.
fn content_to_delete_event_join() -> RelationDef {
    let def: RelationDef = ContentModel::Entity::belongs_to(EventModel::Entity)
        .from(ContentModel::Column::DigestType)
        .to(EventModel::Column::ContentDigestType)
        .into();
    def.on_condition(|c, e| {
        Expr::col((c, ContentModel::Column::DigestBytes))
            .equals((e, EventModel::Column::ContentDigestBytes))
            .into_condition()
    })
}

/// Keep only tombstone bundles whose Delete event is allowed to
/// remove its target. A tombstone is valid when:
///   1. The Delete event's signer identity matches the target row's
///      identity (you can only delete your own content).
///   2. The Delete event's signer is authorized under the
///      identity's chain
pub async fn validate_tombstones(
    ctx: &ServiceContext,
    deletes_by_target: HashMap<TargetEventKey, Vec<EventBundle>>,
) -> Result<HashMap<TargetEventKey, Vec<EventBundle>>, Status> {
    let mut validated: HashMap<TargetEventKey, Vec<EventBundle>> =
        HashMap::with_capacity(deletes_by_target.len());

    for (target_key, bundles) in deletes_by_target {
        let mut kept = Vec::with_capacity(bundles.len());
        for bundle in bundles {
            if is_tombstone_authorized(ctx, &target_key, &bundle).await? {
                kept.push(bundle);
            }
        }
        if !kept.is_empty() {
            validated.insert(target_key, kept);
        }
    }

    Ok(validated)
}

async fn is_tombstone_authorized(
    ctx: &ServiceContext,
    target_key: &TargetEventKey,
    bundle: &EventBundle,
) -> Result<bool, Status> {
    let Some(signed) = bundle.signed_event.as_ref() else {
        return Ok(false);
    };
    let Ok(event) = Event::decode(signed.event_bytes.as_slice()) else {
        return Ok(false);
    };
    let Some(key) = event.key.as_ref() else {
        return Ok(false);
    };
    let Some(signer) = key.signed_by.as_ref() else {
        return Ok(false);
    };

    // Only self-tombstoning is allowed: signer identity must match the
    // target row's identity.
    if key.identity != target_key.identity {
        return Ok(false);
    }

    match authorize_event_signer(
        &ctx.ro_db,
        &ctx.proof_cache,
        &key.identity,
        signer,
        key.collection,
        &signed.signature,
    )
    .await
    {
        Ok(()) => Ok(true),
        Err(status) if status.code() == Code::PermissionDenied => Ok(false),
        Err(status) => Err(status),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::proto::{EventKey, PublicKey};
    use sea_orm::{DbBackend, MockDatabase};
    use std::sync::Arc;

    async fn mock_ctx() -> Arc<ServiceContext> {
        let kafka_producer = common_kafka::build_producer()
            .await
            .expect("failed to build Kafka producer");
        ServiceContext::new(
            MockDatabase::new(DbBackend::Postgres).into_connection(),
            kafka_producer,
        )
    }

    fn target_key(identity: &str) -> TargetEventKey {
        TargetEventKey {
            collection: 2,
            identity: identity.to_string(),
            public_key_type: 1,
            public_key: vec![0xaa; 32],
            sequence: 1,
        }
    }

    /// Build an EventBundle whose inner Event encodes the given key.
    /// The signature is left empty — these tests only exercise the
    /// pre-authorization fast-fail paths, which never read it.
    fn bundle_with_key(key: Option<EventKey>) -> EventBundle {
        let event = Event {
            key,
            identity_sequence: 0,
            vector_clock: None,
            previous_signature: vec![],
            content_digest: None,
            created_at: 0,
            previous_root: vec![],
            application: None,
        };
        EventBundle {
            signed_event: Some(SignedEvent {
                signature: vec![],
                event_bytes: prost::Message::encode_to_vec(&event),
            }),
            serialized_content: None,
            event_proofs: vec![],
            meta: None,
        }
    }

    fn key_with(
        identity: &str,
        signer: Option<PublicKey>,
        collection: i32,
    ) -> EventKey {
        EventKey {
            collection,
            identity: identity.to_string(),
            signed_by: signer,
            sequence: 7,
        }
    }

    #[tokio::test]
    async fn rejects_bundle_without_signed_event() {
        let ctx = mock_ctx().await;
        let bundle = EventBundle {
            signed_event: None,
            serialized_content: None,
            event_proofs: vec![],
            meta: None,
        };
        let result =
            is_tombstone_authorized(&ctx, &target_key("alice"), &bundle).await;
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn rejects_undecodable_event_bytes() {
        let ctx = mock_ctx().await;
        let bundle = EventBundle {
            signed_event: Some(SignedEvent {
                signature: vec![],
                // 0xff is a reserved wire type — never decodes as Event.
                event_bytes: vec![0xffu8],
            }),
            serialized_content: None,
            event_proofs: vec![],
            meta: None,
        };
        let result =
            is_tombstone_authorized(&ctx, &target_key("alice"), &bundle).await;
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn rejects_event_with_no_key() {
        let ctx = mock_ctx().await;
        let bundle = bundle_with_key(None);
        let result =
            is_tombstone_authorized(&ctx, &target_key("alice"), &bundle).await;
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn rejects_key_with_no_signed_by() {
        let ctx = mock_ctx().await;
        let bundle = bundle_with_key(Some(key_with("alice", None, 6)));
        let result =
            is_tombstone_authorized(&ctx, &target_key("alice"), &bundle).await;
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn rejects_signer_identity_mismatch() {
        let ctx = mock_ctx().await;
        let signer = Some(PublicKey {
            key_type: 1,
            key: vec![0xbb; 32],
        });
        // Delete event was signed for "mallory" but targets "alice".
        let bundle = bundle_with_key(Some(key_with("mallory", signer, 6)));
        let result =
            is_tombstone_authorized(&ctx, &target_key("alice"), &bundle).await;
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn validate_tombstones_passes_through_empty_input() {
        let ctx = mock_ctx().await;
        let validated =
            validate_tombstones(&ctx, HashMap::new()).await.unwrap();
        assert!(validated.is_empty());
    }

    #[tokio::test]
    async fn validate_tombstones_drops_target_when_all_bundles_invalid() {
        let ctx = mock_ctx().await;
        let bad = bundle_with_key(None);
        let mut deletes: HashMap<TargetEventKey, Vec<EventBundle>> =
            HashMap::new();
        deletes.insert(target_key("alice"), vec![bad]);
        let validated = validate_tombstones(&ctx, deletes).await.unwrap();
        assert!(validated.is_empty());
    }
}
