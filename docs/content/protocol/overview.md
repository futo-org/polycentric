---
title: Protocol Overview
sidebar_label: Overview
sidebar_position: 1
---

# Protocol Overview

Harbor is the flagship implementation of the **Polycentric Protocol**. This
documentation is preliminary and tracks the v2 protocol, defined in the
`protos/polycentric/v2` directory of the
[Harbor code repository](https://gitlab.futo.org/polycentric/polycentric).

The Polycentric Protocol is built on three ideas:

- **Asymmetric cryptography** — every event is signed by a key the user controls.
- **Append-only event collections** — each signer writes a sequentially numbered,
  hash-linked log.
- **Eventual consistency** — clients reconcile events from multiple servers and
  converge on the same state, using CRDT semantics for mutable values.

There are two roles: **clients** and **servers**. A client chooses which servers to
publish its events to. Other clients fetch those events from any server that holds
them. Servers place limited trust in each other and clients place limited trust in
servers — if a server is unavailable or hides data, clients read from elsewhere.

## Identities and keys

An **identity** is not a server account. It is a document
([`Identity`](./data-model.md#identity)) describing a set of keys:

- **Rotation keys** — a list of public keys that control the identity itself and
  can authorize new keys.
- **Signing keys** — keys allowed to sign events but not to change the identity
  document.
- **Revocation bounds** — when a key is revoked, the identity records the key's last
  valid position in each collection, so events it signed before revocation remain
  verifiable.
- **Recovery signature** — a signature that can authorize an identity event as a
  valid identity recovery with a new rotation key.
- **Recovery key** — a public key that can be used to verify a recovery signature
  in a subsequent identity event.

The identity is itself the first thing written, in a reserved collection (see below).
An identity is referred to by its `identity` key — the SHA-256 hash of that initial
identity content.

## Collections

Each identity writes events into numbered **collections**. A collection is an
append-only log; within a collection an event's `sequence` is its logical clock. The
reserved collections are:

| Collection | Purpose                       |
| ---------- | ----------------------------- |
| 1          | Identity                      |
| 2          | Feed (posts)                  |
| 3          | Profile                       |
| 4          | Interactions (reactions, etc.)|
| 5          | Social graph (follows)        |

An event is addressed by an [`EventKey`](./data-model.md#eventkey): the tuple of
`(collection, identity, signed_by, sequence)`.

## Events and content

To keep events small and cacheable, an [`Event`](./data-model.md#event)
references its content by digest rather than embedding it. The body lives in a
separate [`Content`](./data-model.md#content) message, and the event carries a
`ContentDigest` (SHA-256 over the serialized content). The two travel together in an
[`EventBundle`](./data-model.md#eventbundle), which lets a recipient verify that
the content matches the digest the event signed.

An event is signed as a [`SignedEvent`](./data-model.md#signedevent): the
signature is computed over the serialized `Event` bytes, and those exact bytes are
stored as-is so the signature stays verifiable regardless of how a library
re-serializes the message.

An event also names the [`Application`](./data-model.md#application) that created
it: a display name, a package identifier, a version, and a website. Because it sits
inside the signed bytes it is the author's own statement, not something a server adds.
Clients use it to show where a post came from, and servers can report which
applications are in use. See
[Declaring Your Application](../developer/declaring-your-application.md).

## Hash-linking and proofs

Within a collection, each event records:

- `previous_signature` — the signature of the previous event by the same key, forming
  an immutable chain.
- `previous_root` — an [RFC 6962](https://datatracker.ietf.org/doc/html/rfc6962)
  Merkle root over that signer's prior signatures in the collection.

Later events therefore attest to the writer's history. An
[`EventProof`](./data-model.md#eventproof) is a Merkle inclusion proof showing
that a given event is a leaf in the tree rooted at some later event. This is what
makes revocation safe: the identity's revocation bounds anchor verification at a known
head, and proofs establish which events fall before the revocation point.

## Vector clocks

An event's [`VectorClock`](./data-model.md#vectorclock) records information
about the event's signer's knowledge of other events in the collection at the
time of creating the event. More specifically, it records the highest known
sequence number that each signer in the identity document referenced by the
event has used in the same collection as the event.

## Mutable values (CRDTs)

Some state is a single mutable value rather than an append-only stream — a display
name, an avatar, a follow relationship. These use last-writer-wins semantics so that
concurrent updates from different devices converge. The current value is whatever the
latest event in the relevant collection sets.

## Servers and discovery

Basic synchronization (fetching a user's events) requires little trust: a client can
ask any server for an identity's events and verify every signature itself. Search,
recommendation, and curated feeds are different — they are computed by servers. A
client queries several servers, deduplicates, and attributes results, so no single
server fully controls what a user sees. See
[Protocol → gRPC](./grpc.md) for the feed and sync APIs.
