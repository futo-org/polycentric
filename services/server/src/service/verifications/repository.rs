use ::entity::{
    content, content_verification_claim, content_verification_target,
    content_verification_verify, event,
};
use polycentric_common::models::collections;
use sea_orm::sea_query::extension::postgres::PgBinOper;
use sea_orm::sea_query::{Alias, Expr, Query as SeaQuery};
use sea_orm::*;
use std::collections::HashSet;

use crate::data::EventWithContentRow;
use crate::service::events::TargetEventKey;
use crate::service::events::tombstone::HasEventKey;
use crate::service::feeds::repository::content_join;

const VERIFICATIONS_COLLECTION: i16 = collections::VERIFICATIONS as i16;

/// Upper bound on rows returned by any single verification query.
const MAX_ROWS: u64 = 200;

/// A verification request: the key of the VerificationTarget event that
/// asked (for tombstone checks) and the key of the claim it references.
#[derive(Debug, Clone)]
pub struct VerificationTargetDto {
    pub target_key: TargetEventKey,
    pub claim_key: TargetEventKey,
}

/// A target/verify event together with the claim key it references, so
/// callers can group verification state per claim.
#[derive(Debug, Clone)]
pub struct VerificationEventDto {
    pub event: event::Model,
    pub content: Option<content::Model>,
    pub claim_key: TargetEventKey,
}

impl VerificationEventDto {
    pub fn into_row(self) -> EventWithContentRow {
        (self.event, self.content)
    }
}

impl HasEventKey for VerificationEventDto {
    fn event_key(&self) -> TargetEventKey {
        TargetEventKey::of(&self.event)
    }
}

/// `Condition` matching any of `$keys` on a child table's five
/// `claim_event_key_*` columns.
macro_rules! claim_keys_condition {
    ($table:ident, $keys:expr) => {{
        let mut matches_any = Condition::any();
        for key in $keys.iter().take(MAX_ROWS as usize) {
            matches_any = matches_any.add(
                Condition::all()
                    .add(
                        $table::Column::ClaimEventKeyCollection
                            .eq(key.collection),
                    )
                    .add(
                        $table::Column::ClaimEventKeyIdentity
                            .eq(key.identity.as_str()),
                    )
                    .add(
                        $table::Column::ClaimEventKeyPublicKeyType
                            .eq(key.public_key_type),
                    )
                    .add(
                        $table::Column::ClaimEventKeyPublicKey
                            .eq(key.public_key.clone()),
                    )
                    .add(
                        $table::Column::ClaimEventKeySequence.eq(key.sequence),
                    ),
            );
        }
        matches_any
    }};
}

/// The claim's `TargetEventKey` from a child table row's denormalized
/// columns.
macro_rules! claim_key_of {
    ($row:expr) => {
        TargetEventKey {
            collection: $row.claim_event_key_collection,
            identity: $row.claim_event_key_identity,
            public_key_type: $row.claim_event_key_public_key_type,
            public_key: $row.claim_event_key_public_key,
            sequence: $row.claim_event_key_sequence,
        }
    };
}

pub struct Query;

impl Query {
    /// VerificationClaim events published by an identity.
    pub async fn list_claim_events_for_identity(
        db: &DbConn,
        identity: &str,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        event::Entity::find()
            .select_also(content::Entity)
            .join(JoinType::InnerJoin, content_join())
            .join(JoinType::InnerJoin, claim_join())
            .filter(event::Column::Collection.eq(VERIFICATIONS_COLLECTION))
            .filter(event::Column::Identity.eq(identity))
            .order_by_desc(event::Column::Sequence)
            .limit(MAX_ROWS)
            .all(db)
            .await
    }

    /// VerificationClaim events whose decoded `fields` contain every pair in
    /// `match_fields` (JSONB containment), optionally restricted to a schema
    /// by its digest, AND that a `verified_by` identity has verified.
    /// Tombstones NOT yet filtered.
    ///
    /// The trust requirement is a correlated `EXISTS` applied BEFORE the row
    /// limit: publishing a claim needs no authorization, so without it an
    /// attacker could publish `MAX_ROWS` junk claims carrying a target's
    /// field values and push the genuinely-verified claim out of the window,
    /// denying its resolution. Bounding the scan to claims a trusted identity
    /// actually verified — a set the attacker cannot inflate — closes that.
    /// (A claim admitted via a since-revoked verify is dropped later, when
    /// tombstones are validated.)
    pub async fn list_claim_events_by_fields(
        db: &DbConn,
        schema_digest: Option<(i32, Vec<u8>)>,
        match_fields: serde_json::Value,
        verified_by: &HashSet<String>,
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        let mut select = event::Entity::find()
            .select_also(content::Entity)
            .join(JoinType::InnerJoin, content_join())
            .join(JoinType::InnerJoin, claim_join())
            .filter(event::Column::Collection.eq(VERIFICATIONS_COLLECTION))
            .filter(
                Expr::col((
                    content_verification_claim::Entity,
                    content_verification_claim::Column::Fields,
                ))
                .binary(
                    PgBinOper::Contains,
                    Expr::val(match_fields).cast_as(Alias::new("jsonb")),
                ),
            )
            .filter(Expr::exists(verified_by_trusted_subquery(verified_by)));
        if let Some((digest_type, digest_bytes)) = schema_digest {
            select = select
                .filter(
                    content_verification_claim::Column::SchemaDigestType
                        .eq(digest_type),
                )
                .filter(
                    content_verification_claim::Column::SchemaDigestBytes
                        .eq(digest_bytes),
                );
        }
        select
            .order_by_desc(event::Column::Sequence)
            // Deterministic tiebreaker: `sequence` is a per-identity counter,
            // so it does not totally order rows across identities.
            .order_by_desc(event::Column::Id)
            .limit(MAX_ROWS)
            .all(db)
            .await
    }

    /// VerificationTarget events published by the claims' owners that
    /// reference any of `claim_keys`.
    pub async fn list_target_events_for_claims(
        db: &DbConn,
        claim_keys: &[TargetEventKey],
    ) -> Result<Vec<VerificationEventDto>, DbErr> {
        if claim_keys.is_empty() {
            return Ok(Vec::new());
        }
        let rows = event::Entity::find()
            .select_also(content::Entity)
            .join(JoinType::InnerJoin, content_join())
            .and_also_related(content_verification_target::Entity)
            .filter(event::Column::Collection.eq(VERIFICATIONS_COLLECTION))
            .filter(claim_keys_condition!(
                content_verification_target,
                claim_keys
            ))
            // Only the claim owner's own targeting events count.
            .filter(Expr::col((event::Entity, event::Column::Identity)).equals(
                (
                    content_verification_target::Entity,
                    content_verification_target::Column::ClaimEventKeyIdentity,
                ),
            ))
            .order_by_desc(event::Column::Sequence)
            .limit(MAX_ROWS)
            .all(db)
            .await?;

        // A target event naming several identities joins to several target
        // rows; keep each event once.
        let mut seen: HashSet<i64> = HashSet::new();
        Ok(rows
            .into_iter()
            .filter_map(|(event, content, target)| {
                let target = target?;
                if !seen.insert(event.id) {
                    return None;
                }
                Some(VerificationEventDto {
                    event,
                    content,
                    claim_key: claim_key_of!(target),
                })
            })
            .collect())
    }

    /// VerificationVerify events verifying any of `claim_keys`, from any
    /// identity.
    pub async fn list_verify_events_for_claims(
        db: &DbConn,
        claim_keys: &[TargetEventKey],
    ) -> Result<Vec<VerificationEventDto>, DbErr> {
        if claim_keys.is_empty() {
            return Ok(Vec::new());
        }
        let rows = event::Entity::find()
            .select_also(content::Entity)
            .join(JoinType::InnerJoin, content_join())
            .and_also_related(content_verification_verify::Entity)
            .filter(event::Column::Collection.eq(VERIFICATIONS_COLLECTION))
            .filter(claim_keys_condition!(
                content_verification_verify,
                claim_keys
            ))
            .order_by_desc(event::Column::Sequence)
            .limit(MAX_ROWS)
            .all(db)
            .await?;

        let mut seen: HashSet<i64> = HashSet::new();
        Ok(rows
            .into_iter()
            .filter_map(|(event, content, verify)| {
                let verify = verify?;
                if !seen.insert(event.id) {
                    return None;
                }
                Some(VerificationEventDto {
                    event,
                    content,
                    claim_key: claim_key_of!(verify),
                })
            })
            .collect())
    }

    /// Verification requests naming `target_identity`, restricted to
    /// targets published by the referenced claim's own owner. Newest first,
    /// tombstones NOT yet filtered.
    pub async fn list_targets_for_identity(
        db: &DbConn,
        target_identity: &str,
    ) -> Result<Vec<VerificationTargetDto>, DbErr> {
        let rows = event::Entity::find()
            .select_also(content_verification_target::Entity)
            .join(JoinType::InnerJoin, content_join())
            .join(JoinType::InnerJoin, target_join())
            .filter(event::Column::Collection.eq(VERIFICATIONS_COLLECTION))
            .filter(
                content_verification_target::Column::TargetIdentity
                    .eq(target_identity),
            )
            // Only the claim's own owner can ask for its verification.
            .filter(Expr::col((event::Entity, event::Column::Identity)).equals(
                (
                    content_verification_target::Entity,
                    content_verification_target::Column::ClaimEventKeyIdentity,
                ),
            ))
            .order_by_desc(event::Column::CreatedAt)
            .order_by_desc(event::Column::Id)
            .limit(MAX_ROWS)
            .all(db)
            .await?;
        // The inner join guarantees the target row.
        Ok(rows
            .into_iter()
            .filter_map(|(event, target)| {
                let target = target?;
                Some(VerificationTargetDto {
                    target_key: TargetEventKey::of(&event),
                    claim_key: claim_key_of!(target),
                })
            })
            .collect())
    }

    /// True when the claim's own owner has published a VerificationTarget
    /// naming `target_identity` for `claim_key` — i.e. that identity was
    /// requested to verify the claim.
    pub async fn was_verification_requested(
        db: &DbConn,
        claim_key: &TargetEventKey,
        target_identity: &str,
    ) -> Result<bool, DbErr> {
        let count = event::Entity::find()
            .join(JoinType::InnerJoin, content_join())
            .join(JoinType::InnerJoin, target_join())
            .filter(event::Column::Collection.eq(VERIFICATIONS_COLLECTION))
            .filter(
                content_verification_target::Column::TargetIdentity
                    .eq(target_identity),
            )
            .filter(claim_keys_condition!(
                content_verification_target,
                std::slice::from_ref(claim_key)
            ))
            // Only the claim's own owner can ask for its verification.
            .filter(Expr::col((event::Entity, event::Column::Identity)).equals(
                (
                    content_verification_target::Entity,
                    content_verification_target::Column::ClaimEventKeyIdentity,
                ),
            ))
            .count(db)
            .await?;
        Ok(count > 0)
    }

    /// VerificationClaim events matching the given keys exactly. Newest
    /// first by sequence, tombstones NOT yet filtered.
    pub async fn list_claim_events_by_keys(
        db: &DbConn,
        keys: &[TargetEventKey],
    ) -> Result<Vec<EventWithContentRow>, DbErr> {
        if keys.is_empty() {
            return Ok(Vec::new());
        }
        let mut matches_any = Condition::any();
        for key in keys.iter().take(MAX_ROWS as usize) {
            matches_any = matches_any.add(
                Condition::all()
                    .add(event::Column::Collection.eq(key.collection))
                    .add(event::Column::Identity.eq(key.identity.as_str()))
                    .add(event::Column::PublicKeyType.eq(key.public_key_type))
                    .add(event::Column::PublicKey.eq(key.public_key.clone()))
                    .add(event::Column::Sequence.eq(key.sequence)),
            );
        }
        event::Entity::find()
            .select_also(content::Entity)
            .join(JoinType::InnerJoin, content_join())
            // A target may reference any event key; only claims qualify.
            .join(JoinType::InnerJoin, claim_join())
            .filter(matches_any)
            .order_by_desc(event::Column::Sequence)
            .limit(MAX_ROWS)
            .all(db)
            .await
    }
}

/// Relation joining a content row to its VerificationTarget rows.
fn target_join() -> RelationDef {
    content::Entity::belongs_to(content_verification_target::Entity)
        .from(content::Column::Id)
        .to(content_verification_target::Column::ContentId)
        .into()
}

/// Relation joining a content row to its VerificationClaim row.
fn claim_join() -> RelationDef {
    content::Entity::belongs_to(content_verification_claim::Entity)
        .from(content::Column::Id)
        .to(content_verification_claim::Column::ContentId)
        .into()
}

/// Correlated sub-select for `EXISTS`: a VerificationVerify authored by one
/// of `verified_by` that references the OUTER claim event. Walks
/// `content_verification_verify → content → events` (the verify event) to
/// reach the attesting signer's identity; the verify event and its content
/// are aliased (`ve`/`vc`) so the outer query's own `events`/`content` stay
/// referenceable for the claim-key correlation. Tombstone validity is not a
/// pure SQL predicate and is enforced later in the pipeline.
fn verified_by_trusted_subquery(
    verified_by: &HashSet<String>,
) -> sea_query::SelectStatement {
    let ve = Alias::new("ve");
    let vc = Alias::new("vc");
    let mut sub = SeaQuery::select();
    sub.expr(Expr::val(1))
        .from(content_verification_verify::Entity)
        .join_as(
            JoinType::InnerJoin,
            content::Entity,
            vc.clone(),
            Expr::col((vc.clone(), content::Column::Id)).equals((
                content_verification_verify::Entity,
                content_verification_verify::Column::ContentId,
            )),
        )
        .join_as(
            JoinType::InnerJoin,
            event::Entity,
            ve.clone(),
            Expr::col((ve.clone(), event::Column::ContentDigestType))
                .equals((vc.clone(), content::Column::DigestType))
                .and(
                    Expr::col((ve.clone(), event::Column::ContentDigestBytes))
                        .equals((vc.clone(), content::Column::DigestBytes)),
                ),
        )
        .and_where(
            Expr::col((ve.clone(), event::Column::Collection))
                .eq(VERIFICATIONS_COLLECTION),
        )
        .and_where(
            Expr::col((ve.clone(), event::Column::Identity))
                .is_in(verified_by.iter().cloned()),
        )
        // Correlate the verify row to the outer (unaliased) claim event.
        .and_where(
            Expr::col((
                content_verification_verify::Entity,
                content_verification_verify::Column::ClaimEventKeyCollection,
            ))
            .equals((event::Entity, event::Column::Collection)),
        )
        .and_where(
            Expr::col((
                content_verification_verify::Entity,
                content_verification_verify::Column::ClaimEventKeyIdentity,
            ))
            .equals((event::Entity, event::Column::Identity)),
        )
        .and_where(
            Expr::col((
                content_verification_verify::Entity,
                content_verification_verify::Column::ClaimEventKeyPublicKeyType,
            ))
            .equals((event::Entity, event::Column::PublicKeyType)),
        )
        .and_where(
            Expr::col((
                content_verification_verify::Entity,
                content_verification_verify::Column::ClaimEventKeyPublicKey,
            ))
            .equals((event::Entity, event::Column::PublicKey)),
        )
        .and_where(
            Expr::col((
                content_verification_verify::Entity,
                content_verification_verify::Column::ClaimEventKeySequence,
            ))
            .equals((event::Entity, event::Column::Sequence)),
        );
    sub
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::sea_query::PostgresQueryBuilder;

    /// The trust `EXISTS` must (a) filter the verify EVENT's identity, and
    /// (b) correlate the verify row's claim key to the OUTER (unaliased)
    /// `events` — not the aliased inner verify event — or every claim would
    /// wrongly pass. Guards against an alias/correlation regression the mock
    /// test harness cannot catch (it never executes SQL).
    #[test]
    fn trusted_subquery_correlates_to_outer_claim_event() {
        let trusted: HashSet<String> =
            ["FUTO".to_string()].into_iter().collect();
        let sql = verified_by_trusted_subquery(&trusted)
            .to_string(PostgresQueryBuilder);

        // Verifier identity is checked on the aliased inner verify event.
        assert!(sql.contains(r#""ve"."identity" IN ('FUTO')"#), "sql: {sql}");
        // Claim-key correlation targets the outer, unaliased events table.
        assert!(
            sql.contains(
                r#""content_verification_verify"."claim_event_key_identity" = "events"."identity""#
            ),
            "sql: {sql}"
        );
        assert!(
            sql.contains(
                r#""content_verification_verify"."claim_event_key_sequence" = "events"."sequence""#
            ),
            "sql: {sql}"
        );
    }
}
