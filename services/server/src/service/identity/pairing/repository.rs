use crate::service::proto as Proto;
use ::entity::pairing_session_claimer_model as PairingSessionClaimerModel;
use ::entity::pairing_session_model as PairingSessionModel;
use sea_orm::*;

pub struct Query;

impl Query {
    /// Returns the pairing session with this digest hash, if one exists.
    pub async fn get_pairing_session(
        db: &DbConn,
        digest_sha256: &[u8],
    ) -> Result<Option<PairingSessionModel::Model>, DbErr> {
        PairingSessionModel::Entity::find()
            .filter(PairingSessionModel::Column::DigestSha256.eq(digest_sha256))
            .one(db)
            .await
    }

    /// Lists the claimers that have joined the session with this digest hash.
    pub async fn list_claimers(
        db: &DbConn,
        digest_sha256: &[u8],
    ) -> Result<Vec<Proto::PublicKey>, DbErr> {
        let rows = PairingSessionClaimerModel::Entity::find()
            .filter(
                PairingSessionClaimerModel::Column::DigestSha256
                    .eq(digest_sha256),
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
        let row = PairingSessionClaimerModel::ActiveModel {
            issuer_identity: Set(issuer_identity.to_string()),
            digest_sha256: Set(digest_sha256.to_vec()),
            claimer_key_type: Set(claimer_key.key_type),
            claimer_key: Set(claimer_key.key.clone()),
        };

        let res = PairingSessionClaimerModel::Entity::insert(row)
            .on_conflict(
                sea_query::OnConflict::columns([
                    PairingSessionClaimerModel::Column::DigestSha256,
                    PairingSessionClaimerModel::Column::ClaimerKeyType,
                    PairingSessionClaimerModel::Column::ClaimerKey,
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
    ) -> Result<Option<PairingSessionModel::Model>, DbErr> {
        PairingSessionModel::Entity::find_by_id(issuer_identity)
            .lock_exclusive()
            .one(txn)
            .await
    }

    /// Deletes every claimer of every session issued by `issuer_identity`.
    pub async fn clear_claimers(
        txn: &DatabaseTransaction,
        issuer_identity: &str,
    ) -> Result<(), DbErr> {
        PairingSessionClaimerModel::Entity::delete_many()
            .filter(
                PairingSessionClaimerModel::Column::IssuerIdentity
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
        row: PairingSessionModel::ActiveModel,
    ) -> Result<(), DbErr> {
        PairingSessionModel::Entity::insert(row)
            .on_conflict(
                sea_query::OnConflict::column(
                    PairingSessionModel::Column::IssuerIdentity,
                )
                .update_columns([
                    PairingSessionModel::Column::DigestSha256,
                    PairingSessionModel::Column::IssuerStateBytes,
                    PairingSessionModel::Column::IssuerStateSignature,
                    PairingSessionModel::Column::InitialTimestamp,
                    PairingSessionModel::Column::Sequence,
                ])
                .to_owned(),
            )
            .exec_without_returning(txn)
            .await?;

        Ok(())
    }
}
