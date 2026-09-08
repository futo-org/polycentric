pub mod repository;
pub mod rpc;
pub mod tombstone;

use entity::event;
use tonic::Status;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TargetEventKey {
    pub collection: i16,
    pub identity: String,
    pub public_key_type: i16,
    pub public_key: Vec<u8>,
    pub sequence: i64,
}

impl TargetEventKey {
    pub fn of(event: &event::Model) -> Self {
        Self {
            collection: event.collection,
            identity: event.identity.clone(),
            public_key_type: event.public_key_type,
            public_key: event.public_key.clone(),
            sequence: event.sequence,
        }
    }

    /// Validate a request-supplied `EventKey` into its DB-shaped parts.
    /// `field` names the request field in error messages.
    pub fn from_request(
        key: Option<crate::service::proto::EventKey>,
        field: &str,
    ) -> Result<Self, Status> {
        let key = key.ok_or_else(|| {
            Status::invalid_argument(format!("{field} is required"))
        })?;
        if key.identity.is_empty() {
            return Err(Status::invalid_argument(format!(
                "{field}.identity is required"
            )));
        }
        let signed_by = key.signed_by.ok_or_else(|| {
            Status::invalid_argument(format!("{field}.signed_by is required"))
        })?;
        let collection: i16 = key.collection.try_into().map_err(|_| {
            Status::invalid_argument(format!("{field}.collection out of range"))
        })?;
        let public_key_type: i16 =
            signed_by.key_type.try_into().map_err(|_| {
                Status::invalid_argument(format!(
                    "{field}.signed_by.key_type out of range"
                ))
            })?;
        let sequence: i64 = key.sequence.try_into().map_err(|_| {
            Status::invalid_argument(format!("{field}.sequence out of range"))
        })?;

        Ok(Self {
            collection,
            identity: key.identity,
            public_key_type,
            public_key: signed_by.key,
            sequence,
        })
    }
}
