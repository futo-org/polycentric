use crate::service::proto as Proto;
use ::entity::{pairing_session, pairing_session_claimer};
use sea_orm::*;

pub struct Query;

impl Query {
    /// Returns the pairing session with this digest hash, if one exists.
    pub async fn get_pairing_session(
        db: &DbConn,
        digest_sha256: &[u8],
    ) -> Result<Option<pairing_session::Model>, DbErr> {
        pairing_session::Entity::find()
            .filter(pairing_session::Column::DigestSha256.eq(digest_sha256))
            .one(db)
            .await
    }

    /// Lists the claimers that have joined the session with this digest hash.
    pub async fn list_claimers(
        db: &DbConn,
        digest_sha256: &[u8],
    ) -> Result<Vec<Proto::PublicKey>, DbErr> {
        let rows = pairing_session_claimer::Entity::find()
            .filter(
                pairing_session_claimer::Column::DigestSha256.eq(digest_sha256),
            )
            .all(db)
            .await?;

        Ok(rows
            .into_iter()
            .map(|row| Proto::PublicKey {
                key_type: row.claimer_key_type,
                key: row.claimer_key,
            })
            .collect())
    }

    /// Records a claimer for the session with this digest hash.
    /// Claimers that have already joined are ignored.
    pub async fn add_claimer(
        db: &DbConn,
        issuer_identity: &str,
        digest_sha256: &[u8],
        claimer_key: &Proto::PublicKey,
    ) -> Result<(), DbErr> {
        let row = pairing_session_claimer::ActiveModel {
            issuer_identity: Set(issuer_identity.to_string()),
            digest_sha256: Set(digest_sha256.to_vec()),
            claimer_key_type: Set(claimer_key.key_type),
            claimer_key: Set(claimer_key.key.clone()),
        };

        let res = pairing_session_claimer::Entity::insert(row)
            .on_conflict(
                sea_query::OnConflict::columns([
                    pairing_session_claimer::Column::DigestSha256,
                    pairing_session_claimer::Column::ClaimerKeyType,
                    pairing_session_claimer::Column::ClaimerKey,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(db)
            .await;

        match res {
            Ok(_) | Err(DbErr::RecordNotInserted) => Ok(()),
            Err(err) => Err(err),
        }
    }

    /// Returns the pairing session currently stored for `issuer_identity`.
    pub async fn get_latest_pairing_session(
        txn: &DatabaseTransaction,
        issuer_identity: &str,
    ) -> Result<Option<pairing_session::Model>, DbErr> {
        pairing_session::Entity::find_by_id(issuer_identity)
            .lock_exclusive()
            .one(txn)
            .await
    }

    /// Deletes every claimer of every session issued by `issuer_identity`.
    pub async fn clear_claimers(
        txn: &DatabaseTransaction,
        issuer_identity: &str,
    ) -> Result<(), DbErr> {
        pairing_session_claimer::Entity::delete_many()
            .filter(
                pairing_session_claimer::Column::IssuerIdentity
                    .eq(issuer_identity),
            )
            .exec(txn)
            .await?;

        Ok(())
    }

    /// Writes the issuer state for a pairing session, replacing whatever
    /// session was stored for this issuer.
    pub async fn put_issuer_state(
        txn: &DatabaseTransaction,
        row: pairing_session::ActiveModel,
    ) -> Result<(), DbErr> {
        pairing_session::Entity::insert(row)
            .on_conflict(
                sea_query::OnConflict::column(
                    pairing_session::Column::IssuerIdentity,
                )
                .update_columns([
                    pairing_session::Column::DigestSha256,
                    pairing_session::Column::IssuerStateBytes,
                    pairing_session::Column::IssuerStateSignature,
                    pairing_session::Column::InitialTimestamp,
                    pairing_session::Column::Sequence,
                ])
                .to_owned(),
            )
            .exec_without_returning(txn)
            .await?;

        Ok(())
    }
}
