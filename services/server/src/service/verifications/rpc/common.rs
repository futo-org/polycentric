//! Pipeline stages shared by the verifications RPC handlers, composed
//! with `pipeline::create_pipeline`. Each handler supplies its own `fetch`;
//! `claim_bundles` serves the claim-list RPCs (claims wrapped with their
//! targets and verifies) and `event_list` the flat single-list RPCs.

use tonic::Status;

pub(crate) fn map_db_err(e: sea_orm::DbErr) -> Status {
    tracing::error!(error = %e, "verifications db error");
    Status::internal("internal server error")
}

/// Stages producing `VerificationClaimBundle`s: each claim wrapped with the
/// targets and verifies referencing it.
pub(crate) mod claim_bundles {
    use crate::data::hydration::{HydrationState, collect_identities};
    use crate::data::{EventWithContentRow, assemble_bundles, row_into_bundle};
    use crate::service::context::ServiceContext;
    use crate::service::events::TargetEventKey;
    use crate::service::events::tombstone::{self, HasEventKey};
    use crate::service::identity::service::list_identity_and_profile_events;
    use crate::service::proofs::service::attach_proofs;
    use crate::service::proto::{EventHint, VerificationClaimBundle};
    use crate::service::verifications::repository::{
        Query as Repository, VerificationEventDto,
    };
    use std::collections::HashMap;
    use tonic::Status;

    use super::map_db_err;

    /// Claim rows together with the verification events that reference them.
    pub(crate) struct FetchedClaims {
        pub claims: Vec<EventWithContentRow>,
        pub targets: Vec<VerificationEventDto>,
        pub verifies: Vec<VerificationEventDto>,
    }

    /// Complete a handler's `fetch` stage: the targets and verifies
    /// referencing `claims`.
    pub(crate) async fn fetch_verification_state(
        ctx: &ServiceContext,
        claims: Vec<EventWithContentRow>,
    ) -> Result<FetchedClaims, Status> {
        let claim_keys: Vec<TargetEventKey> =
            claims.iter().map(HasEventKey::event_key).collect();

        let targets =
            Repository::list_target_events_for_claims(&ctx.ro_db, &claim_keys)
                .await
                .map_err(map_db_err)?;
        let verifies =
            Repository::list_verify_events_for_claims(&ctx.ro_db, &claim_keys)
                .await
                .map_err(map_db_err)?;
        Ok(FetchedClaims {
            claims,
            targets,
            verifies,
        })
    }

    /// Validated tombstones for every fetched event (in one lookup), plus
    /// identity-chain and profile events for every referenced identity.
    pub(crate) async fn hydrate<P>(
        ctx: &ServiceContext,
        _params: &P,
        fetched: &FetchedClaims,
    ) -> Result<HydrationState, Status> {
        let keys: Vec<TargetEventKey> = fetched
            .claims
            .iter()
            .map(HasEventKey::event_key)
            .chain(fetched.targets.iter().map(HasEventKey::event_key))
            .chain(fetched.verifies.iter().map(HasEventKey::event_key))
            .collect();
        let deletes_by_target =
            tombstone::validated_tombstones(ctx, &keys).await?;

        let identities = collect_identities::<(
            &entity::event_model::Model,
            Option<&entity::content_model::Model>,
        )>(
            ctx.trusted_moderator.as_deref(),
            fetched
                .claims
                .iter()
                .map(|(event, content)| (event, content.as_ref()))
                .chain(
                    fetched
                        .targets
                        .iter()
                        .map(|dto| (&dto.event, dto.content.as_ref())),
                )
                .chain(
                    fetched
                        .verifies
                        .iter()
                        .map(|dto| (&dto.event, dto.content.as_ref())),
                ),
        );
        let (identity_events, profile_events) =
            list_identity_and_profile_events(ctx, identities).await?;

        Ok(HydrationState {
            deletes_by_target,
            identity_events,
            profile_events,
            ..Default::default()
        })
    }

    /// Drop tombstoned claims, targets, and verifies.
    pub(crate) async fn filter<P>(
        _ctx: &ServiceContext,
        _params: &P,
        fetched: FetchedClaims,
        hydration: &HydrationState,
    ) -> Result<FetchedClaims, Status> {
        fn live<T: HasEventKey>(
            rows: Vec<T>,
            hydration: &HydrationState,
        ) -> Vec<T> {
            rows.into_iter()
                .filter(|row| {
                    !hydration.deletes_by_target.contains_key(&row.event_key())
                })
                .collect()
        }

        Ok(FetchedClaims {
            claims: live(fetched.claims, hydration),
            targets: live(fetched.targets, hydration),
            verifies: live(fetched.verifies, hydration),
        })
    }

    /// The claim bundles plus identity/profile hints.
    pub(crate) struct View {
        pub claim_bundles: Vec<VerificationClaimBundle>,
        pub event_hints: Vec<EventHint>,
    }

    /// Group targets and verifies under their claim, attach proofs, and
    /// ship the hydrated identity/profile events as hints.
    pub(crate) async fn view<P>(
        ctx: &ServiceContext,
        _params: &P,
        filtered: FetchedClaims,
        hydration: HydrationState,
    ) -> Result<View, Status> {
        let mut targets_by_claim: HashMap<
            TargetEventKey,
            Vec<EventWithContentRow>,
        > = HashMap::new();
        for target in filtered.targets {
            targets_by_claim
                .entry(target.claim_key.clone())
                .or_default()
                .push(target.into_row());
        }
        let mut verifies_by_claim: HashMap<
            TargetEventKey,
            Vec<EventWithContentRow>,
        > = HashMap::new();
        for verify in filtered.verifies {
            verifies_by_claim
                .entry(verify.claim_key.clone())
                .or_default()
                .push(verify.into_row());
        }

        let mut claim_bundles = Vec::with_capacity(filtered.claims.len());
        for row in filtered.claims {
            let key = row.event_key();
            claim_bundles.push(VerificationClaimBundle {
                claim: Some(row_into_bundle(row)),
                targets: assemble_bundles(
                    targets_by_claim.remove(&key).unwrap_or_default(),
                    &hydration.stats,
                ),
                verifies: assemble_bundles(
                    verifies_by_claim.remove(&key).unwrap_or_default(),
                    &hydration.stats,
                ),
            });
        }

        for bundle in &mut claim_bundles {
            if let Some(claim) = bundle.claim.as_mut() {
                attach_proofs(ctx, std::slice::from_mut(claim)).await?;
            }
            attach_proofs(ctx, &mut bundle.targets).await?;
            attach_proofs(ctx, &mut bundle.verifies).await?;
        }
        Ok(View {
            claim_bundles,
            event_hints: hydration.identity_profile_hints(),
        })
    }
}

/// Stages producing a flat `EventBundle` list.
pub(crate) mod event_list {
    use crate::data::hydration::{HydrationState, collect_identities};
    use crate::data::{EventWithContentRow, assemble_bundles};
    use crate::service::context::ServiceContext;
    use crate::service::events::TargetEventKey;
    use crate::service::events::tombstone::{self, HasEventKey};
    use crate::service::identity::service::list_identity_and_profile_events;
    use crate::service::proofs::service::attach_proofs;
    use crate::service::proto::{EventBundle, EventHint};
    use tonic::Status;

    /// Validated tombstones for the fetched events, plus identity-chain
    /// and profile events for every referenced identity.
    #[allow(clippy::ptr_arg)] // signature must match pipeline's HRTB (&Fetched = &Vec<…>)
    pub(crate) async fn hydrate<P>(
        ctx: &ServiceContext,
        _params: &P,
        rows: &Vec<EventWithContentRow>,
    ) -> Result<HydrationState, Status> {
        let keys: Vec<TargetEventKey> =
            rows.iter().map(HasEventKey::event_key).collect();
        let deletes_by_target =
            tombstone::validated_tombstones(ctx, &keys).await?;

        let identities =
            collect_identities(ctx.trusted_moderator.as_deref(), rows.iter());
        let (identity_events, profile_events) =
            list_identity_and_profile_events(ctx, identities).await?;

        Ok(HydrationState {
            deletes_by_target,
            identity_events,
            profile_events,
            ..Default::default()
        })
    }

    /// Drop tombstoned rows.
    pub(crate) async fn filter<P>(
        _ctx: &ServiceContext,
        _params: &P,
        rows: Vec<EventWithContentRow>,
        hydration: &HydrationState,
    ) -> Result<Vec<EventWithContentRow>, Status> {
        Ok(rows
            .into_iter()
            .filter(|row| {
                !hydration.deletes_by_target.contains_key(&row.event_key())
            })
            .collect())
    }

    /// The event bundles plus identity/profile hints.
    pub(crate) struct View {
        pub event_bundles: Vec<EventBundle>,
        pub event_hints: Vec<EventHint>,
    }

    /// Bundle the rows, attach proofs, and ship the hydrated
    /// identity/profile events as hints.
    pub(crate) async fn view<P>(
        ctx: &ServiceContext,
        _params: &P,
        rows: Vec<EventWithContentRow>,
        hydration: HydrationState,
    ) -> Result<View, Status> {
        let mut event_bundles = assemble_bundles(rows, &hydration.stats);
        attach_proofs(ctx, &mut event_bundles).await?;
        Ok(View {
            event_bundles,
            event_hints: hydration.identity_profile_hints(),
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use crate::service::context::ServiceContext;
    use crate::service::proto::content::ContentBody;
    use crate::service::proto::{
        Content, EventKey, PublicKey, VerificationClaim, VerificationTarget,
        VerificationVerify,
    };
    use ::entity::content_model as ContentModel;
    use ::entity::content_verification_target_model as TargetModel;
    use ::entity::content_verification_verify_model as VerifyModel;
    use ::entity::event_model as EventModel;
    use chrono::DateTime;
    use polycentric_common::models::collections;
    use prost::Message as _;
    use sea_orm::prelude::DateTimeWithTimeZone;
    use sea_orm::{
        DatabaseConnection, EntityTrait, IdenStatic, IntoMockRow, Iterable,
        MockRow, ModelTrait, SelectA, SelectB, SelectC, Value,
    };
    use std::collections::BTreeMap;
    use std::sync::Arc;

    pub(crate) async fn ctx(db: DatabaseConnection) -> Arc<ServiceContext> {
        let kafka_producer = common_kafka::build_producer()
            .await
            .expect("failed to build Kafka producer");
        ServiceContext::new(db, kafka_producer)
    }

    fn ts(seconds: i64) -> DateTimeWithTimeZone {
        DateTime::from_timestamp_secs(seconds)
            .unwrap()
            .fixed_offset()
    }

    /// The claim EventKey every fixture references.
    pub(crate) fn claim_event_key(identity: &str) -> EventKey {
        EventKey {
            collection: collections::VERIFICATIONS,
            identity: identity.to_string(),
            signed_by: Some(PublicKey {
                key_type: 1,
                key: vec![0xaa],
            }),
            sequence: 7,
        }
    }

    pub(crate) fn event_row(id: i64, identity: &str) -> EventModel::Model {
        EventModel::Model {
            id,
            collection: collections::VERIFICATIONS as i16,
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

    fn content_row(id: i64, content: Content) -> ContentModel::Model {
        ContentModel::Model {
            id,
            digest_type: 1,
            digest_bytes: vec![id as u8],
            serialized_bytes: content.encode_to_vec(),
            synced_at: ts(id),
        }
    }

    fn target_table_model(
        id: i64,
        owner: &str,
        target: &str,
    ) -> TargetModel::Model {
        TargetModel::Model {
            content_id: id,
            target_identity: target.to_string(),
            claim_event_key_collection: collections::VERIFICATIONS as i16,
            claim_event_key_identity: owner.to_string(),
            claim_event_key_public_key_type: 1,
            claim_event_key_public_key: vec![0xaa],
            claim_event_key_sequence: 7,
        }
    }

    /// A row of the three-entity queries; MockDatabase has no built-in
    /// support for model triples.
    fn three_model_row<M, N, O>(a: M, b: N, c: O) -> MockRow
    where
        M: ModelTrait,
        N: ModelTrait,
        O: ModelTrait,
    {
        let mut row: BTreeMap<String, Value> = BTreeMap::new();
        for column in <<M as ModelTrait>::Entity as EntityTrait>::Column::iter()
        {
            row.insert(
                format!("{}{}", SelectA.as_str(), column.as_str()),
                a.get(column),
            );
        }
        for column in <<N as ModelTrait>::Entity as EntityTrait>::Column::iter()
        {
            row.insert(
                format!("{}{}", SelectB.as_str(), column.as_str()),
                b.get(column),
            );
        }
        for column in <<O as ModelTrait>::Entity as EntityTrait>::Column::iter()
        {
            row.insert(
                format!("{}{}", SelectC.as_str(), column.as_str()),
                c.get(column),
            );
        }
        row.into_mock_row()
    }

    /// Row of the targets query: a VerificationTarget event by `owner`.
    pub(crate) fn target_row(
        id: i64,
        owner: &str,
        targets: &[&str],
    ) -> MockRow {
        let content = Content {
            content_body: Some(ContentBody::VerificationTarget(
                VerificationTarget {
                    claim_event_key: Some(claim_event_key(owner)),
                    target_identities: targets
                        .iter()
                        .map(|s| s.to_string())
                        .collect(),
                },
            )),
        };
        three_model_row(
            event_row(id, owner),
            content_row(id, content),
            target_table_model(id, owner, targets[0]),
        )
    }

    /// Row of the verifies query: a VerificationVerify by `verifier` of
    /// `claim_owner`'s claim.
    pub(crate) fn verify_row(
        id: i64,
        verifier: &str,
        claim_owner: &str,
    ) -> MockRow {
        let content = Content {
            content_body: Some(ContentBody::VerificationVerify(
                VerificationVerify {
                    claim_event_key: Some(claim_event_key(claim_owner)),
                },
            )),
        };
        three_model_row(
            event_row(id, verifier),
            content_row(id, content),
            VerifyModel::Model {
                content_id: id,
                claim_event_key_collection: collections::VERIFICATIONS as i16,
                claim_event_key_identity: claim_owner.to_string(),
                claim_event_key_public_key_type: 1,
                claim_event_key_public_key: vec![0xaa],
                claim_event_key_sequence: 7,
            },
        )
    }

    /// (event, content) row for a VerificationClaim by `owner`. The event
    /// carries the sequence from `claim_event_key` so targets and verifies
    /// built from these fixtures group under it.
    pub(crate) fn claim_row(
        id: i64,
        owner: &str,
    ) -> (EventModel::Model, ContentModel::Model) {
        let content = Content {
            content_body: Some(ContentBody::VerificationClaim(
                VerificationClaim::default(),
            )),
        };
        let mut event = event_row(id, owner);
        event.sequence = claim_event_key(owner).sequence as i64;
        (event, content_row(id, content))
    }

    /// (event, target-table) row for the requests-inbox query.
    pub(crate) fn target_table_row(
        id: i64,
        owner: &str,
        target: &str,
    ) -> (EventModel::Model, TargetModel::Model) {
        (event_row(id, owner), target_table_model(id, owner, target))
    }

    /// Empty result set for any mocked query.
    pub(crate) fn no_rows() -> Vec<MockRow> {
        Vec::new()
    }
}
