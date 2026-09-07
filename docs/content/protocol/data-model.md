---
title: Data Model
sidebar_label: Data Model
sidebar_position: 2
---

# Data Model

The Polycentric Protocol is a binary protocol using
[Protocol Buffers v3](https://protobuf.dev/). The messages below are the v2
definitions from the `protos/polycentric/v2` directory of the
[Harbor code repository](https://gitlab.futo.org/polycentric/polycentric). RPC
request/response messages are covered in [gRPC](./grpc.md).

## Keys and identity

### KeyType

The only supported key type is Ed25519.

```protobuf
enum KeyType {
  KEY_TYPE_UNSPECIFIED = 0;
  KEY_TYPE_ED25519 = 1;
}
```

### PublicKey

There is usually one public key per account, per device.

```protobuf
message PublicKey {
  // Type of key used. Defaults to ED25519.
  KeyType key_type = 1;
  // Value of the key
  bytes key = 2;
}
```

### Identity

The identity document. `rotation_keys` control the identity and can issue new keys;
`signing_keys` may sign events but not change the document; `revocation_bounds`
preserve the verifiability of events from a revoked key.

```protobuf
message Identity {
  repeated PublicKey rotation_keys = 1;
  repeated PublicKey signing_keys = 2;
  repeated RevocationBound revocation_bounds = 3;
  ServerList servers = 4;
  optional PublicKey recovery_key = 5;
  optional bytes recovery_signature = 6;
}

message RevocationBound {
  // Key that is revoked
  PublicKey revoked_key = 1;
  // One target per collection `revoked_key` wrote in, anchoring proof
  // verification at that collection's head event.
  repeated EventProofTarget targets = 2;
}

// Per-collection target for verifying an EventProof.
message EventProofTarget {
  int32 collection = 1;
  // Event's signature; matched by `EventProof.target_signature`.
  bytes signature = 2;
  // Event's `previous_root` — the Merkle root proofs verify against.
  bytes root = 3;
  // Leaf count of the tree at `root`.
  uint64 leaf_count = 4;
}
```

### EventKey

The unique identifier of an event.

```protobuf
message EventKey {
  // Reserved collections:
  // 1 -> Identity, 2 -> Feed, 3 -> Profile,
  // 4 -> Interactions, 5 -> Social graph,
  // 6 -> Reports, 7 -> Labels, 8 -> Verifications
  int32 collection = 1;

  // Identity key (sha256 hash of the initial Identity content)
  string identity = 2;

  // Public key that signed the event
  PublicKey signed_by = 3;

  // Sequence number of the event in the collection (logical clock)
  uint64 sequence = 4;
}
```

## Events

### VectorClock

The sequence numbers (of the same collection) the signing key is aware of.

```protobuf
message VectorClock {
  repeated uint64 sequence = 1;
}
```

### Event

References, but does not contain, its content.

```protobuf
message Event {
  // Key for the event
  EventKey key = 1;

  // Reference to the sequence, of the Identity Collection (1), that holds
  // the identity document
  uint64 identity_sequence = 2;

  VectorClock vector_clock = 3;

  // Signature of the previous event signed by the same key.
  bytes previous_signature = 4;

  // Digest of the content
  ContentDigest content_digest = 6;

  // Creation time, in milliseconds
  uint64 created_at = 7;

  // RFC 6962 Merkle root over this signer's prior signatures in this
  // collection (leaf_count = key.sequence - 1).
  bytes previous_root = 8;

  // The application that created the event. Absent when unknown.
  optional Application application = 9;
}
```

### Application

The application that authored an event. It is signed as part of the event, so it is
the author's own claim and cannot be changed afterwards.

```protobuf
message Application {
  // Human-readable name, e.g. "Harbor".
  string name = 1;
  // Reverse-DNS package or bundle identifier, e.g. "org.futo.polycentric".
  string id = 2;
  // Version of the application, e.g. "1.2.0".
  string version = 3;
  // Website of the application, e.g. "https://harbor.social".
  string url = 4;
}
```

Every application that writes events should set this on each one it creates. See
[Declaring Your Application](../developer/declaring-your-application.md) for what to
put in each field and how the SDKs stamp it for you.

### SignedEvent

The signature is computed over `event_bytes`, not over a re-encoded `Event`. The bytes
are stored as-is so the signature stays verifiable.

```protobuf
message SignedEvent {
  // Signature of event_bytes below
  bytes signature = 1;
  // Serialized representation of the Event message that is signed against
  bytes event_bytes = 2;
}
```

### EventBundle

Bundles a `SignedEvent` with its serialized content and any inclusion proofs. The
content is carried as `SerializedContent` so its checksum can be verified against the
event's `ContentDigest`.

```protobuf
message EventBundle {
  SignedEvent signed_event = 1;
  optional SerializedContent serialized_content = 2;
  repeated EventProof event_proofs = 3;
}
```

### EventProof

An [RFC 6962](https://datatracker.ietf.org/doc/html/rfc6962) Merkle inclusion proof:
the bundle's `SignedEvent` is the leaf at `leaf_index` in the tree rooted at the
target identified by `target_signature`.

```protobuf
message EventProof {
  bytes target_signature = 1;
  uint64 leaf_index = 2;
  // RFC 6962 audit path: sibling hashes from leaf toward root.
  repeated bytes audit_path = 3;
}
```

### EventHint

Extra events a server may return to save the client a round trip — for example, the
root and parent posts of a reply, plus the author's latest profile event.

```protobuf
message EventHint {
  EventBundle event_bundle = 1;
}
```

## Content

### ContentDigest

```protobuf
enum ContentDigestType {
  CONTENT_DIGEST_TYPE_UNSPECIFIED = 0;
  CONTENT_DIGEST_TYPE_SHA256 = 1;
}

message ContentDigest {
  ContentDigestType type = 1;
  // Hash of the serialized content bytes
  bytes value = 2;
}
```

### Content

The body of an event. Exactly one variant is set.

```protobuf
message Content {
  oneof content_body {
    Post post = 2;
    Delete delete = 3;
    Follow follow = 4;
    Block block = 5;
    Reaction reaction = 6;
    ProfileUpdate profile_update = 7;
    Identity identity = 8;
    Repost repost = 9;
    Report report = 10;
    Labels labels = 11;
  }
}

// What the ContentDigest is computed over.
message SerializedContent {
  bytes content_bytes = 1;
}
```

### Post, PostReply, Repost

```protobuf
message Post {
  string text = 1;
  optional PostReply reply = 2;
  repeated ImageSet images = 3;
  optional EventKey quote = 4;
  repeated Link links = 5;
}

message PostReply {
  // Initial post in the reply chain
  EventKey root = 1;
  // Post being replied to
  EventKey parent = 2;
}

message Repost {
  optional EventKey post = 1;
}

#### Link

```protobuf
message Link {
  string title = 1;
  string description = 2;
  string image = 3;
  string url = 4;
}
```

### Delete

A `Delete` tells a server to forget the contents of a previous event. The server keeps
the data only if it is still referenced by another event.

```protobuf
message Delete {
  EventKey event_key = 1;
}
```

### Follow, Block

```protobuf
message Follow {
  string identity = 1;
}

message Block {
  string identity = 1;
}
```

### Reaction

```protobuf
message Reaction {
  // Key of the event being reacted to
  EventKey event_key = 1;
  optional string emoji = 2;
  // Upvote = true, downvote = false
  bool positive = 3;
}
```

### ProfileUpdate

```protobuf
message ProfileUpdate {
  optional string name = 1;
  optional ImageSet avatar = 2;
  optional ImageSet banner = 3;
  optional string description = 4;
}
```

### Report

A `Report` flags another event for a category of policy violation. Reports are
themselves signed events, so a server can record who reported what and respond
according to its own moderation policy (moderation is per-server). `additional_info`
carries optional free-text context.

```protobuf
message Report {
  // Event being reported
  EventKey event_key = 1;
  ReportCategory category = 2;
  string additional_info = 3;
}

enum ReportCategory {
  REPORT_CATEGORY_UNSPECIFIED = 0;
  REPORT_CATEGORY_SPAM = 1;
  REPORT_CATEGORY_ABUSE = 2;
  REPORT_CATEGORY_CHILD_SAFETY = 3;
  REPORT_CATEGORY_TERRORISM = 4;
  REPORT_CATEGORY_ILLEGAL = 5;
  REPORT_CATEGORY_COPYRIGHT = 6;
  REPORT_CATEGORY_SERVER_POLICY = 7;
}
```

### Labels

A `Labels` event records that a moderation service has classified content
against a set of label values. Labels are signed events in collection 7
(`Labels`). Like `Report`, labeling is per-server — a server indexes and
serves only labels from its configured trusted moderation service (set via
`POLYCENTRIC_MODERATION_IDENTITY` on the server side). Labels from any other
identity are stored and synced as normal events but are not indexed or served
when querying feeds.

The server returns matching `Labels` events as `EventHint` entries alongside
feed results; the client correlates each hint's event bundle to its target
by event key and renders it according to the user's preference
(Hide / Warn / Show). Because `EventHint` is a generic container, the client
differentiates label hints from identity/profile hints by checking whether the
event's collection is 7 (`Labels`).

```protobuf
message Labels {
  // Event being labeled
  EventKey event_key = 1;
  // Label values applied, e.g. "sexually-suggestive" or "hate".
  repeated string label_values = 2;
}
```

### Blob, Image, ImageSet

Media is stored as blobs in object storage and referenced by digest. Images may carry
multiple size variants.

```protobuf
message Blob {
  ContentDigest digest = 1;
  string mime_type = 2;
  int64 size = 3;
}

message Image {
  Blob blob = 1;
  int32 width = 2;
  int32 height = 3;
}

message ImageSet {
  repeated Image images = 1;
}
```
