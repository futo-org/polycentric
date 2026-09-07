use crate::data::hydration::event_identities;
use crate::service::events::TargetEventKey;
use crate::service::stats::service::{EventStats, include_stats};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use entity::{content_model, event_model};
use polycentric_common::models::protos_v2 as proto;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tonic::Status;

pub mod hydration;
pub mod pipeline;

pub type EventId = i64;

/// Row that contains an event.
pub trait EventRow {
    /// Returns the event model and optionally content for the row.
    fn as_event_with_content(
        &self,
    ) -> (&event_model::Model, Option<&content_model::Model>);

    /// Returns the event model for the row.
    fn as_event(&self) -> &event_model::Model {
        self.as_event_with_content().0
    }

    /// Returns the event id.
    fn event_id(&self) -> EventId {
        self.as_event().id
    }

    /// Returns the content of the event, if any.
    fn as_content(&self) -> Option<&content_model::Model> {
        self.as_event_with_content().1
    }

    /// Collects all identities in the event and adds them to `identities`.
    fn collect_identities(&self, identities: &mut HashSet<String>) {
        let (event, content) = self.as_event_with_content();
        event_identities(event, content, identities);
    }

    fn event_key(&self) -> TargetEventKey {
        TargetEventKey::of(self.as_event())
    }
}

/// `(event_model::Model, Option<content_model::Model>)` — the shape every
/// event-returning query already produces.
pub type EventWithContentRow =
    (event_model::Model, Option<content_model::Model>);

impl EventRow for EventWithContentRow {
    fn as_event_with_content(
        &self,
    ) -> (&event_model::Model, Option<&content_model::Model>) {
        (&self.0, self.1.as_ref())
    }

    fn as_event(&self) -> &event_model::Model {
        &self.0
    }

    fn as_content(&self) -> Option<&content_model::Model> {
        self.1.as_ref()
    }
}

impl EventRow for (&event_model::Model, Option<&content_model::Model>) {
    fn as_event_with_content(
        &self,
    ) -> (&event_model::Model, Option<&content_model::Model>) {
        *self
    }

    fn as_event(&self) -> &event_model::Model {
        self.0
    }

    fn as_content(&self) -> Option<&content_model::Model> {
        self.1
    }
}

impl<T> EventRow for &T
where
    T: EventRow,
{
    fn as_event_with_content(
        &self,
    ) -> (&event_model::Model, Option<&content_model::Model>) {
        T::as_event_with_content(self)
    }

    fn as_event(&self) -> &event_model::Model {
        T::as_event(self)
    }

    fn as_content(&self) -> Option<&content_model::Model> {
        T::as_content(self)
    }

    fn collect_identities(&self, identities: &mut HashSet<String>) {
        T::collect_identities(self, identities)
    }
}

/// Assemble multiple rows into bundles.
pub fn assemble_bundles(
    rows: impl IntoIterator<Item = EventWithContentRow>,
    stats: &EventStats,
) -> Vec<proto::EventBundle> {
    rows.into_iter()
        .map(|row| assemble_bundle(row, stats))
        .collect::<Vec<_>>()
}

/// Assemble a single row into a bundle.
pub fn assemble_bundle(
    row: EventWithContentRow,
    stats: &EventStats,
) -> proto::EventBundle {
    let event_id = row.0.id;
    let mut bundle = row_into_bundle(row);
    include_stats(&mut bundle.meta, event_id, stats);
    bundle
}

/// Assemble a single row into an event hint.
pub fn assemble_hint(
    row: EventWithContentRow,
    stats: &EventStats,
) -> proto::EventHint {
    bundle_into_hint(assemble_bundle(row, stats))
}

/// Convert multiple rows into bundles, without adding metadata.
///
/// See [`assemble_bundles`] to attached stats.
pub fn rows_into_bundles(
    rows: impl IntoIterator<Item = EventWithContentRow>,
) -> Vec<proto::EventBundle> {
    rows.into_iter().map(row_into_bundle).collect::<Vec<_>>()
}

/// Convert a row into a bundle, without adding metadata.
///
/// See [`assemble_bundle`] to attached stats.
pub fn row_into_bundle(
    (event, content): EventWithContentRow,
) -> proto::EventBundle {
    proto::EventBundle {
        signed_event: Some(proto::SignedEvent {
            event_bytes: event.event_bytes,
            signature: event.signature,
        }),
        serialized_content: content.map(|c| proto::SerializedContent {
            content_bytes: c.serialized_bytes,
        }),
        event_proofs: Vec::new(),
        meta: None,
    }
}

/// Convert multiple rows into event hints, without adding metadata.
///
/// See [`assemble_hint`] to attached stats.
pub fn rows_into_hints(
    rows: impl IntoIterator<Item = EventWithContentRow>,
) -> Vec<proto::EventHint> {
    rows.into_iter()
        .map(|row| bundle_into_hint(row_into_bundle(row)))
        .collect::<Vec<_>>()
}

/// Convert a single row into an event hint.
fn row_into_hint(row: EventWithContentRow) -> proto::EventHint {
    bundle_into_hint(row_into_bundle(row))
}

/// Convert a bundle into an event hint.
pub fn bundle_into_hint(bundle: proto::EventBundle) -> proto::EventHint {
    proto::EventHint {
        event_bundle: Some(bundle),
    }
}

const DEFAULT_LIMIT: u32 = 50;

/// Parameters for pagination.
///
/// For example used by [`pipeline::finalize_fetch`].
pub struct PaginationParams<SortedBy> {
    pub cursor_filter: Option<CursorFilter<SortedBy>>,
    pub limit: u32,
}

impl<SortedBy> PaginationParams<SortedBy> {
    /// Decode the cursor filter from the request parameters.
    ///
    /// Returns the cursor filter and limit.
    ///
    /// If `params` is empty it returns a forward cursor starting at the start
    /// with a default limit.
    pub fn from_req_params(
        params: Option<&proto::PageParams>,
    ) -> Result<PaginationParams<SortedBy>, Status>
    where
        SortedBy: for<'a> Deserialize<'a>,
    {
        let Some(params) = params else {
            return Ok(PaginationParams {
                cursor_filter: None,
                limit: DEFAULT_LIMIT,
            });
        };

        let limit = match params.limit {
            Some(limit) => limit.clamp(1, 200).cast_unsigned(),
            None => DEFAULT_LIMIT,
        };

        let cursor_filter =
            match (&params.backward_token, &params.forward_token) {
                (Some(_), Some(_)) => {
                    return Err(Status::invalid_argument(
                        "Only one cursor is allowed",
                    ));
                }
                (Some(token), None) => {
                    Some(CursorFilter::Backward(Cursor::decode(token)?))
                }
                (None, Some(token)) => {
                    Some(CursorFilter::Forward(Cursor::decode(token)?))
                }
                (None, None) => None,
            };

        Ok(PaginationParams {
            cursor_filter,
            limit,
        })
    }
}

/// [`PageInfo`] to return to the client, except with our types instead of
/// opaque cursor strings.
///
/// [`PageInfo`]: proto::PageInfo
#[derive(Copy, Clone, Debug, Serialize, Deserialize)]
pub struct PageInfo<SortedBy> {
    pub backward_cursor: Cursor<SortedBy>,
    pub forward_cursor: Cursor<SortedBy>,
    pub has_previous_page: bool,
    pub has_next_page: bool,
}

impl<SortedBy> PageInfo<SortedBy> {
    /// Build the final [`PageInfo`] protobuf message to give the client.
    ///
    /// [`PageInfo`]: proto::PageInfo
    pub fn to_proto(&self) -> Result<proto::PageInfo, Status>
    where
        SortedBy: Serialize,
    {
        let start_cursor = self.backward_cursor.encode()?;
        let end_cursor = self.forward_cursor.encode()?;
        Ok(proto::PageInfo {
            start_cursor,
            end_cursor,
            has_previous_page: self.has_previous_page,
            has_next_page: self.has_next_page,
        })
    }
}

/// Retrieve items in the feed relative to a cursor.
#[derive(Copy, Clone, Debug, Serialize, Deserialize)]
pub enum CursorFilter<SortedBy> {
    Forward(Cursor<SortedBy>),
    Backward(Cursor<SortedBy>),
}

#[derive(Copy, Clone, Debug, Serialize, Deserialize)]
pub enum Cursor<SortedBy> {
    /// Marks the start of the feed.
    ///
    /// Forward queries return the first items and backward queries return
    /// nothing.
    Start,
    /// Marks somewhere in the feed.
    ///
    /// Forward queries return items following this point and backward queries
    /// return items preceding this point.
    Mid(Marker<SortedBy>),
    /// Marks the end of the feed.
    ///
    /// Forward queries return nothing and backward queries return the last
    /// items.
    End,
}

impl<SortedBy> Cursor<SortedBy> {
    pub fn encode(&self) -> Result<String, Status>
    where
        SortedBy: Serialize,
    {
        let bytes = serde_json::to_vec(self).map_err(|e| {
            tracing::error!(error = %e, "encode pagination token");
            Status::internal("internal server error")
        })?;
        Ok(BASE64_STANDARD.encode(bytes))
    }

    pub fn decode(token: &str) -> Result<Cursor<SortedBy>, Status>
    where
        SortedBy: for<'a> Deserialize<'a>,
    {
        let bytes = BASE64_STANDARD.decode(token).map_err(|e| {
            tracing::debug!(error = %e, "decode pagination token");
            Status::invalid_argument("pagination token")
        })?;

        serde_json::from_slice(bytes.as_slice()).map_err(|e| {
            tracing::debug!(error = %e, "decode pagination token");
            Status::invalid_argument("pagination token")
        })
    }
}

/// Exclusive lower/upper bound for a feed query.
#[derive(Copy, Clone, Debug, Serialize, Deserialize)]
pub struct Marker<SortedBy> {
    pub sorted_by: SortedBy,
    /// Event id (`events.id`) to ensure the ordering is always unique.
    pub event_id: EventId,
}

impl<SortedBy> Marker<SortedBy> {
    pub fn values(&self) -> (SortedBy, EventId)
    where
        SortedBy: Copy,
    {
        (self.sorted_by, self.event_id)
    }
}
