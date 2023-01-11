---
label: Protocol
icon: book
---

Note: This protocol documentation is preliminary.

## Basics

The Polycentric protocol is based on [Vector clocks](https://en.wikipedia.org/wiki/Vector_clock), [Asymmetric cryptography](https://en.wikipedia.org/wiki/Public-key_cryptography), and [Conflict-free replicated data types](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type). An understanding of these concepts is required. The core is as follows: A system is identified by a public key. A system is usually a user identity. A process is identified by a random string. A process usually represents a user device. Each event in a system is signed using the system public key, and published by a process. Messages are communicated via a set reconcillation protocol, and state constructed by a consumer of system events under an [eventual consistency](https://en.wikipedia.org/wiki/Eventual_consistency) model.

There are two components: clients, and servers. A client chooses to publish it's systems on multiple servers. An system includes the necessary routing information to find it within a network. When a process is consumed a client will connect to the servers a process is available on and start synchronizing. The set of servers a user chooses to store their own processes on can be totally disjoint from those of the people they are following. The basic system synchronization places very limited trust in servers compared to most models. Should server operators provide unreliable service, or choose to deny service to users, the client automatically fetches systems from other sources.

Many features are very difficult to provide via a trustless methodology, or purely within a client. Examples of these features include recommendation engines, and search. Each Polycentric server provides search and recommendation, but has control over what data it chooses to present. A server could choose to return some results, and not others. To combine the best of both worlds Clients use multiple servers of their choosing to provide search and recommendations. Results are deduplicated and attributed to the server that provided them. This allows using high performance and state of the art solutions to these difficult problems, but limit the manipulation possible by a single actor.

## Core Message Format

Polycentric is a binary protocol based on [Protocol Buffers Version 3](https://developers.google.com/protocol-buffers/docs/proto3).

### Public Key Message

The only supported `key_type` is `0` representing `ed25519`.

```protobuf
message PublicKey {
    uint64 key_type = 1;
    bytes key = 2;
}
```

### Digest Message

The only supported `digest_type` is `0` representing `SHA256`.

```protobuf
message Digest {
    uint64 digest_type = 1;
    bytes digest = 2;
}
```

### System Processes Message

This message represents the other processes of a system known by a given process. A process should not include itself in a `SystemProcesses` message. When a process becomes aware of another process it should publish a new `SystemProcesses` message with the new process included.

```protobuf
message SystemProcesses {
    repeated Process processes = 1;
}
```

### Server Message

Used in conjunction with `LWWElementSet`. This message is used to advertise servers that a storing a events for the system.

```protobuf
message Server {
    string server = 1;
}
```

### Vector Clock Message

A component of `Event`. This is contains the state of the logical clocks of each other process that a process is aware of in the order of the last `SystemProcesses` message. Should a process not be aware of other processes the `VectorClock` will be empty.

```protobuf
message VectorClock {
    repeated uint64 logical_clocks = 1;
}
```

### Index Message

A component of `Indices`.

```protobuf
message Index {
    uint64 index_type = 0;
    uint64 logical_clock = 1;
}
```

### Indices Message

A component of `Event`. `Indices` is a map of back pointers to previous `Events` within a process which may either be updated on a write, or passed on. This may be used to point to the location of a more complex index type, or in the simple case used to establish a chain of particular values for safer partial set reconciliation.

```protobuf
message Indices {
    repeated Index indices = 1;
}
```

### Process Message

Process is a per process random 16 byte identifier.

```protobuf
message Process {
    bytes process = 1;
}
```

### Event Message

```protobuf
message Event {
    PublicKey system = 1;
    Process process = 2;
    uint64 logical_clock = 3;
    uint64 content_type = 4;
    bytes content = 5;
    VectorClock vector_clock = 6;
    Indices indices = 7;
    bytes signature = 8;
}
```

### Pointer Message

Used for addressing an `Event`. The `event_digest` is included such that subject of the pointer cannot be maliciously mutated. An example usage is referencing a post in a reply.

```protobuf
message Pointer {
    PublicKey system = 1;
    Process process = 2;
    uint64 logical_clock = 3;
    Digest event_digest = 4;
}
```

### Last Writer Wins Element Set Message

See the Conflict-free replicated data type [Wikipedia page](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) for more information.

LWWElementSet is `ADD` biased, using `unix_milliseconds` as the conflict resolution timestamp.

```protobuf
message LWWElementSet {
    enum Operation {
        ADD = 1;
        REMOVE = 2;
    }
    Operation operation = 1;
    bytes value = 2;
    uint64 unix_milliseconds = 3;
}
```
### Last Writer Wins Element Message

A CRDT representing a single value. The `unix_milliseconds` value is used for conflict resolution, or `unix_milliseconds` values conflict which `Process` identifier is larger.

```protobuf
message LWWElement {
    bytes value = 2;
    uint64 unix_milliseconds = 3;
}
```

### Delete Message

A `Delete` message instructs implementations to clear the `content` field of a subject message. The `Delete` message is then returned in conjunction with the mutated message when requested as proof that the mutation was not malicious. A `Delete` message may not be the subject of another `Delete`.

```protobuf
message Delete {
    Process process = 1;
    uint64 logical_clock = 2;
}
```

## Microblogging Message Format

### Profile Name Message

Use in conjunction with `LWWElement`.

```protobuf
message ProfileName {
    string profile_name = 1;
}
```

### Profile Description Message

Use in conjunction with `LWWElement`.

```protobuf
message ProfileDescription {
    string profile_description = 2;
}
```

### Follow Message

Use in conjunction with `LWWElementSet`.

```protobuf
message Follow {
    PublicKey system = 1;
}
```

### Post Message

A freestanding message.

```protobuf
message Post {
    string content = 1;
    optional Pointer image = 2;
    optional Pointer boost = 3;
}
```

## Event Content Types

Corresponding to `event.content_type`:

```
0: Delete
1: LWWElementSet<Server>
2: SystemProcesses
3: LWWElementSet<Follow>
4: LWWElement<ProfileName>
5: LWWElement<ProfileDescription>
6: Post
```

## Index Types

```
0: LWWElementSet<Server>
1: SystemProcesses
2: LWWElementSet<Follow>
3: LWWElement<ProfileName>
4: LWWElement<ProfileDescription>
5: Post
```

## Computing An Event Digest

```javascript
const accumulator = new DigestInit();

accumulator.update(littleEndian(event.system.key_type));
accumulator.update(event.system.key);
accumulator.update(event.process.process);
accumulator.update(littleEndian(event.logical_clock));
accumulator.update(littleEndian(event.content_type));
accumulator.update(event.content);

for (const logical_clock of event.vector_clock.logical_clocks) {
    accumulator.update(littleEndian(logical_clock));
}

for (const index of event.indices.indices) {
    accumulator.update(littleEndian(index.index_type));
    accumulator.update(littleEndian(index.logical_clock));
}

const digest = accumulator.final();
```

Event signatures are a signature of an event digest.

## Network

Binary query paramaters are Base64-URL encoded following [RFC 4648](https://datatracker.ietf.org/doc/html/rfc4648#page-7).

### Message Type Events

A simple list of events used in various contexts.

```protobuf
message Events {
    repeated Event events = 1;
}
```

### GET /head?system=...

The head endpoint returns the set of messages required to capture the entire known state of a system. If a single process has an accurate `SystemProcesses` state, only the latest message from that process is returned. If the server has a more complete view of a system than any given process then the latest message from multiple processes may be returned.

This endpoint is intended to be used to spot check servers cheaply. If a given server is being used for synchronization, a client may check that messages are not being hidden by asking other servers for the head.

This endpoint returns `Events`.

### POST /events

The POST events endpoint is used to submit events to a server. This endpoint accepts `Events`.

### GET /ranges?system=...

The ranges endpoint is used to determine messages a server currently has. The result type is `RangesForSystem`. A `Range` is inclusive.

```protobuf
message Range {
    uint64 low = 1;
    uint64 high = 2;
}

message RangesForProcess {
    PublicKey process = 1;
    repeated Range ranges = 2;
}

message RangesForSystem {
    repeated RangesForProcesses = 1;
}
```

### GET /events?system=...&ranges_for_system=...

The GET events endpoint is used to request events in a range, returning an `Events` message.
