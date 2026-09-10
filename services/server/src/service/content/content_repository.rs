use crate::service::proto::Blob;
use ::entity::{content, content_blob};
use chrono::Utc;
use polycentric_common::models::protos_v2::{ContentDigest, ContentDigestType};
use prost::Message;
use sea_orm::ActiveValue::{NotSet, Set};
use sea_orm::sea_query::{Expr, InsertStatement, OnConflict};
use sea_orm::*;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub struct Query;

impl Query {
    /// Look up a blob row by its body digest. `None` if not tracked.
    pub async fn find_blob_by_digest<C: ConnectionTrait>(
        db: &C,
        digest_type: i16,
        digest_bytes: &[u8],
    ) -> Result<Option<content_blob::Model>, DbErr> {
        content_blob::Entity::find()
            .filter(content_blob::Column::DigestType.eq(digest_type))
            .filter(content_blob::Column::DigestBytes.eq(digest_bytes))
            .one(db)
            .await
    }

    /// Search the database for blobs matching the provided digests
    /// and return a set of the digests that were found.
    pub async fn find_digests_in_db<C: ConnectionTrait>(
        db: &C,
        digests: &Vec<&ContentDigest>,
    ) -> Result<HashSet<ContentDigest>, DbErr> {
        if digests.is_empty() {
            return Ok(HashSet::new());
        }

        let digest_tuples = digests
            .iter()
            .map(|digest| (digest.r#type, digest.value.clone()))
            .collect::<Vec<_>>();

        let present = content_blob::Entity::find()
            .filter(
                Expr::tuple([
                    Expr::col(content_blob::Column::DigestType),
                    Expr::col(content_blob::Column::DigestBytes),
                ])
                .in_tuples(digest_tuples),
            )
            .all(db)
            .await?
            .into_iter()
            .map(|row| ContentDigest {
                r#type: row.digest_type as i32,
                value: row.digest_bytes,
            })
            .collect::<HashSet<_>>();

        Ok(present)
    }
}

pub struct Mutation;

impl Mutation {
    async fn add_content<C: ConnectionTrait>(
        db: &C,
        serialized_bytes: &[u8],
        digest: &ContentDigest,
    ) -> Result<Option<i64>, DbErr> {
        let query = Mutation::add_content_query(serialized_bytes, digest);
        let row = db.query_one(&query).await?;
        match row {
            Some(row) => Ok(Some(i64::try_get_by(&row, 0)?)),
            None => Ok(None),
        }
    }

    /// Returns a query to store the event content, returns the id.
    pub fn add_content_query(
        serialized_bytes: &[u8],
        digest: &ContentDigest,
    ) -> InsertStatement {
        let content_row = content::ActiveModel {
            id: NotSet,
            digest_type: Set(digest.r#type),
            digest_bytes: Set(digest.value.clone()),
            serialized_bytes: Set(serialized_bytes.into()),
            synced_at: Set(Utc::now().fixed_offset()),
        };
        let mut query = content::Entity::insert(content_row)
            .on_conflict({
                let mut c = OnConflict::columns([
                    content::Column::DigestType,
                    content::Column::DigestBytes,
                ]);
                c.do_nothing();
                c
            })
            .into_query();
        query.returning_col(content::Column::Id);
        query
    }

    pub async fn save_blob<C: ConnectionTrait>(
        db: &C,
        blob: &Blob,
    ) -> Result<(), DbErr> {
        // Digest for the actual blob data
        let digest = match &blob.digest {
            Some(d) => d,
            None => return Ok(()),
        };

        // Digest for the blob object metadata
        let blob_bytes = blob.encode_to_vec();
        let blob_bytes_digest = Sha256::digest(&blob_bytes).to_vec();

        let content_id = Self::add_content(
            db,
            &blob_bytes,
            &ContentDigest {
                r#type: ContentDigestType::Sha256 as i32,
                value: blob_bytes_digest,
            },
        )
        .await?;

        let Some(content_id) = content_id else {
            // Content with this digest already tracked — the blob child row
            // would have been written then; nothing to do.
            return Ok(());
        };

        let blob_insert =
            content_blob::Entity::insert(content_blob::ActiveModel {
                content_id: Set(content_id),
                digest_type: Set(digest.r#type as i16),
                digest_bytes: Set(digest.value.clone()),
                mime_type: Set(blob.mime_type.clone()),
                size: Set(blob.size),
            })
            .on_conflict(
                OnConflict::columns([
                    content_blob::Column::DigestType,
                    content_blob::Column::DigestBytes,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(db)
            .await;

        match blob_insert {
            Ok(_) | Err(DbErr::RecordNotInserted) => Ok(()),
            Err(e) => Err(e),
        }
    }
}
