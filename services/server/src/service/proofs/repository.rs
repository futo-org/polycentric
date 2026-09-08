//! Database access for EventProof generation.

use entity::event;
use polycentric_common::merkle;
use sea_orm::{ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter};

/// Canonically-ordered signatures in `(identity, collection)`. Delegates
/// to [`polycentric_common::merkle::canonical_signatures`] so client and
/// server agree on the ordering.
pub async fn canonical_signatures<C: ConnectionTrait>(
    db: &C,
    identity: &str,
    collection: i32,
) -> Result<Vec<Vec<u8>>, DbErr> {
    let rows = event::Entity::find()
        .filter(event::Column::Collection.eq(collection as i16))
        .filter(event::Column::Identity.eq(identity))
        .all(db)
        .await?;
    Ok(merkle::canonical_signatures(rows.iter().map(|r| {
        (r.event_bytes.as_slice(), r.signature.as_slice())
    })))
}
