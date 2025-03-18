# Comprehensive Polycentric Guide

## Introduction

This document provides a comprehensive overview of the Polycentric ecosystem,
explaining how the protocol, server, and client libraries work together,
followed by a detailed guide for porting the Polycentric Core library to React
Native.

## Table of Contents

1. [Polycentric Architecture Overview](#polycentric-architecture-overview)

   - [Component Responsibilities](#component-responsibilities)
   - [Architecture Relationships](#architecture-relationships)
   - [Communication Flow](#communication-flow)

2. [Protocol Deep Dive](#protocol-deep-dive)

   - [Core Concepts](#core-concepts)
   - [Data Structures](#data-structures)
   - [Cryptographic Identity](#cryptographic-identity)
   - [CRDTs for Conflict Resolution](#crdts-for-conflict-resolution)

3. [Server Implementation](#server-implementation)

   - [API Endpoints](#api-endpoints)
   - [Data Persistence](#data-persistence)
   - [Synchronization](#synchronization)
   - [Moderation Capabilities](#moderation-capabilities)

4. [Polycentric Core Library](#polycentric-core-library)

   - [Architecture](#architecture)
   - [Key Components](#key-components)
   - [Data Flow](#data-flow)
   - [API Reference](#api-reference)
   - [Common Usage Patterns](#common-usage-patterns)

5. [Persistence Layer Details](#persistence-layer-details)

   - [Abstract Level Interface](#abstract-level-interface)
   - [Store and MetaStore](#store-and-metastore)
   - [Index Implementation](#index-implementation)
   - [Query Patterns](#query-patterns)

6. [React Native Port](#react-native-port)

   - [Overview and Strategy](#overview-and-strategy)
   - [Required Changes](#required-changes)
   - [Implementation Details](#implementation-details)
   - [Testing and Validation](#testing-and-validation)

7. [Implementation Plan](#implementation-plan)

   - [Step-by-Step Approach](#step-by-step-approach)
   - [Timeline and Milestones](#timeline-and-milestones)
   - [Success Criteria](#success-criteria)

8. [Example Implementation](#example-implementation)
   - [Persistence Driver](#persistence-driver)
   - [Integration Example](#integration-example)

---

## Polycentric Architecture Overview

Polycentric is a decentralized social protocol that enables secure, distributed
communication between nodes (devices) in a network. The protocol uses
cryptographic identities, content-addressed storage, and robust synchronization
mechanisms to create a resilient, censorship-resistant platform.

### Component Responsibilities

#### 1. polycentric-protocol

**Purpose**: Defines the core data structures and protocol specifications that
serve as the foundation for all Polycentric components.

**Key Responsibilities**:

- Implements Protocol Buffers schema for messages used throughout the system
- Contains model definitions that represent the fundamental data types
- Provides shared interfaces between server and client components
- Handles cryptographic operations like digest computation and signature
  validation
- Performs data validation and transformation

**Runtime Functionality**:

- Code generation from Protocol Buffers definitions
- Message type identification and conversion
- Cryptographic operations (digest computation)
- Serialization/deserialization between wire format and Rust objects
- Data validation and transformation

#### 2. server

**Purpose**: Implements the backend server infrastructure that provides API
endpoints and manages data persistence.

**Key Responsibilities**:

- Provides API endpoints for clients to interact with the protocol
- Handles data persistence, retrieval, and synchronization
- Manages user authentication and data validation
- Implements moderation capabilities
- Interfaces with external services like PostgreSQL and OpenSearch
- Handles caching and performance optimization

**Relationship with polycentric-protocol**:

- Directly imports the Rust polycentric-protocol crate
- Uses the protocol's model definitions (via `use polycentric_protocol::model`)
- Benefits from Rust's static type system to ensure protocol compliance
- Uses runtime functions provided by the protocol for tasks like digest
  computation and data transformations

#### 3. polycentric-core

**Purpose**: Client-side implementation of the protocol that provides a
TypeScript API for web applications.

**Key Responsibilities**:

- Provides API for web applications to interact with the protocol
- Handles network communication with protocol servers
- Manages local state, caching, and persistence
- Implements queries, synchronization, and event handling
- Acts as a bridge between client applications and Polycentric servers

**Relationship with polycentric-protocol**:

- Uses a TypeScript port of the Protocol Buffers definitions
- Implements the protocol behaviors in TypeScript (not a direct use of the Rust
  implementation)
- Maintains compatibility through shared Protocol Buffers source definitions

### Architecture Relationships

The relationship between these components follows this pattern:

1. **Protocol Definition Source**:

   - Both server and client components derive their protocol definitions from
     the same source - the Protocol Buffers definition files (.proto)

2. **Different Implementations**:

   - The server uses the Rust implementation directly (polycentric-protocol
     crate)
   - The polycentric-core has a separate TypeScript implementation of the same
     protocol

3. **Consistency Mechanism**:

   - Using the same Protocol Buffers source ensures both implementations remain
     compatible despite being in different languages

4. **Separation of Concerns**:
   - The server implementation is optimized for backend operations
   - The client implementation (polycentric-core) is optimized for
     browser/frontend usage

### Communication Flow

1. Client applications use polycentric-core to construct protocol-compliant
   messages
2. polycentric-core serializes these messages and sends them to the server
3. The server receives, deserializes, and processes these messages using
   polycentric-protocol
4. The server constructs responses using polycentric-protocol
5. polycentric-core receives and deserializes these responses for client
   applications

This architecture ensures that despite having different implementations in
different languages, both client and server components speak the same protocol
language, ensuring interoperability across the system.

---

## Protocol Deep Dive

### Core Concepts

The Polycentric protocol is built around a few central concepts:

#### System and Process

The protocol has two core identity concepts:

- **System**: Represents a user identity, associated with a public/private key
  pair
- **Process**: Represents a specific client application or device within a
  system

Each system can have multiple processes, allowing for multiple devices to
operate under the same identity. This multi-process architecture enables a user
to create and sign content from different devices while maintaining a unified
identity.

#### Events

The fundamental data unit in Polycentric is an **Event**. Events are signed
messages that represent various types of content:

- Posts
- Profile information (username, description, avatar)
- Social actions (follows, likes, etc.)
- Claims (identity verification)
- System metadata

Events have several key properties:

- They are immutable
- They are cryptographically signed, ensuring authenticity and integrity
- They are content-addressed (referenced by a hash of their content)
- They form a linked data structure (events can reference other events)

#### Content Types

Polycentric defines various content types for different kinds of data:

- `ContentTypePost`: Text posts with optional images
- `ContentTypeUsername`, `ContentTypeDescription`, `ContentTypeAvatar`: Profile
  information
- `ContentTypeFollow`, `ContentTypeBlock`: Social graph management
- `ContentTypeOpinion`: Likes/dislikes
- `ContentTypeClaim`: Identity verification claims
- Plus many others...

### Data Structures

The protocol defines several key data structures:

#### Event

```
message Event {
  PublicKey system = 1;
  Process process = 2;
  uint64 logicalClock = 3;
  uint64 contentType = 4;
  bytes content = 5;
  VectorClock vectorClock = 6;
  LWWElementSet lwwElementSet = 7;
  LWWElement lwwElement = 8;
  repeated Reference references = 9;
  Indices indices = 10;
  uint64 unixMilliseconds = 11;
}
```

An event is the core unit of data in the protocol, containing:

- **system**: The public key of the creator
- **process**: The specific process (device) that created the event
- **logicalClock**: A sequence number for ordering events from the same process
- **contentType**: Identifies the type of content
- **content**: The actual content payload
- **vectorClock**: For logical ordering across multiple processes
- **references**: Links to other events
- **indices**: For efficient querying

#### SignedEvent

```
message SignedEvent {
  bytes signature = 1;
  bytes event = 2;
  repeated ModerationTag moderationTags = 3;
}
```

A signed event wraps an event with its cryptographic signature, providing:

- **signature**: The Ed25519 signature of the event
- **event**: The serialized event data
- **moderationTags**: Optional moderation metadata

#### CRDTs

```
message LWWElement {
  bytes value = 1;
  uint64 unixMilliseconds = 2;
}

message LWWElementSet {
  enum Operation {
    ADD = 0;
    REMOVE = 1;
  }
  Operation operation = 1;
  bytes value = 2;
  uint64 unixMilliseconds = 3;
}
```

These CRDT (Conflict-free Replicated Data Type) structures enable consistent
state across devices even when updates occur offline or out of order.

### Cryptographic Identity

Polycentric uses Ed25519 for digital signatures:

```
message PublicKey {
  uint64 keyType = 1;
  bytes key = 2;
}

message PrivateKey {
  uint64 keyType = 1;
  bytes key = 2;
}
```

The key points about identity:

1. **Key Generation**: Users generate Ed25519 key pairs
2. **Signing**: Events are signed with the system's private key
3. **Verification**: Signatures are verified using the system's public key
4. **Distributed Trust**: Users can vouch for other users' identities

### CRDTs for Conflict Resolution

Polycentric uses two types of CRDTs to handle concurrent updates:

1. **Last-Write-Wins (LWW) Element**: A simple register that resolves conflicts
   by timestamp

   - Used for single-value data like username, description, avatar

2. **LWW Element Set**: A set that supports add/remove operations
   - Used for collection data like follows, blocks, servers
   - Conflicts resolved by operation type and timestamp

This CRDT approach allows:

- Multiple devices to update state independently
- Automatic conflict resolution when changes are synchronized
- Eventually consistent state across the network

---

## Server Implementation

The Polycentric server, implemented in Rust, provides the backend infrastructure
for the Polycentric network.

### API Endpoints

The server exposes several key endpoints:

#### Data Synchronization

- `/events`: POST to upload events, GET to download events
- `/ranges`: GET to discover available data ranges

#### Queries

- `/head`: Get latest events for a system
- `/query_latest`: Get latest events of specific types
- `/query_index`: Get events by index and pagination
- `/query_references`: Get events that reference a specific event

#### Discovery

- `/resolve_handle`: Resolve a human-readable handle to a system ID
- `/resolve_claim`: Resolve a claim to a system ID
- `/search`: Search for content and profiles

#### Moderation

- `/censor`: Apply moderation to specific content

### Data Persistence

The server stores data in:

1. **PostgreSQL**: For structured data and efficient queries

   - Events are stored in their binary form
   - Indices are maintained for efficient retrieval
   - References are tracked for graph traversal

2. **OpenSearch**: For full-text search capabilities
   - Content is indexed for text search
   - Relevance scoring for search results

### Synchronization

The server implements a sophisticated synchronization protocol:

1. Clients query for available data ranges (`/ranges`)
2. Clients compare local and remote ranges to determine missing data
3. Clients request specific missing data ranges (`/events`)
4. Clients upload local events that don't exist on the server

This approach minimizes bandwidth usage by only transferring missing data.

### Moderation Capabilities

The server includes moderation tools:

1. **Content Tagging**: Apply tags to content for moderation purposes
2. **Server Policies**: Define which content to store or serve
3. **Federated Moderation**: Different servers can have different moderation
   policies

---

## Polycentric Core Library

The Polycentric Core library is the TypeScript client implementation of the
protocol, designed for use in web applications.

### Architecture

The library is organized in a layered architecture:

```
┌─────────────────────────────────────┐
│           API Methods               │
├─────────────────────────────────────┤
│                                     │
│         Process Handle              │
│                                     │
├─────────┬───────────────┬───────────┤
│ Queries │ Synchronizer  │ Protocol  │
├─────────┴───────┬───────┴───────────┤
│      Store      │   Meta Store      │
├─────────────────┴───────────────────┤
│       Persistence Driver            │
└─────────────────────────────────────┘
```

### Key Components

#### Persistence Driver

The persistence layer provides an abstract interface for storage operations:

```typescript
export interface IPersistenceDriver {
  getImplementationName: () => string;
  openStore: (path: string) => Promise<BinaryAbstractLevel>;
  estimateStorage: () => Promise<StorageEstimate>;
  persisted: () => Promise<boolean>;
  destroyStore: (path: string) => Promise<void>;
}
```

The library includes a memory-based implementation and can be extended with
other storage backends.

#### Meta Store

The MetaStore manages stores for different systems and versions:

```typescript
export interface IMetaStore {
  openStore: (
    system: PublicKey,
    version: number,
  ) => Promise<BinaryAbstractLevel>;
  deleteStore: (system: PublicKey, version: number) => Promise<void>;
  listStores: () => Promise<StoreInfo[]>;
  setStoreReady: (system: PublicKey, version: number) => Promise<void>;
  setActiveStore: (system: PublicKey, version: number) => Promise<void>;
  unsetActiveStore: () => Promise<void>;
  getActiveStore: () => Promise<StoreInfo | undefined>;
}
```

#### Store

The Store class manages data indexing and retrieval:

```typescript
class Store {
  private readonly level: PersistenceDriver.BinaryAbstractLevel;
  readonly indexEvents: IndexEvents;
  readonly indexSystemStates: IndexSystemState;
  readonly indexProcessStates: IndexProcessState;
  readonly indexEventsForSystemByTime: IndexEventsForSystemByTime;
  readonly indexOpinion: IndexOpinion;
  readonly indexCRDTElementSet: IndexCRDTElementSet;
  readonly indexFeed: IndexFeed;
  readonly indexSystemProcessContentTypeLogicalClock: IndexSystemProcessContentTypeClock;
  // ...
}
```

Each index handles a specific aspect of the data for efficient querying.

#### Process Handle

The ProcessHandle is the main interface for interacting with the protocol:

```typescript
export class ProcessHandle {
  private readonly _processSecret: Models.ProcessSecret.ProcessSecret;
  private readonly _store: Store.Store;
  private readonly _system: Models.PublicKey.PublicKey;
  // ...

  public readonly queryManager: Queries.QueryManager.QueryManager;
  public readonly synchronizer: Synchronization.Synchronizer;

  // Methods for interacting with the protocol
  // ...
}
```

It provides methods for creating and signing events, managing social
relationships, posting content, and synchronizing data.

#### Queries

The query system provides various ways to retrieve data:

```typescript
export class QueryManager {
  public readonly queryBlob: QueryBlob;
  public readonly queryCRDT: QueryCRDT;
  public readonly queryCRDTSet: QueryCRDTSet;
  public readonly queryCursor: QueryCursor;
  public readonly queryEvent: QueryEvent;
  public readonly queryHead: QueryHead;
  public readonly queryIndex: QueryIndex;
  public readonly queryLatest: QueryLatest;
  public readonly queryServers: QueryServers;
  public readonly queryTopStringReferences: QueryTopStringReferences;
  // ...
}
```

#### Synchronization

The Synchronizer handles data synchronization between devices:

```typescript
export class Synchronizer {
  private readonly _processHandle: ProcessHandle.ProcessHandle;
  // ...

  public synchronizationHint(): Promise<void> {
    // Trigger synchronization
  }
  // ...
}
```

#### API Methods

The API methods provide network communication with servers:

```typescript
// Post events to a server
export async function postEvents(
  server: string,
  events: Models.SignedEvent.SignedEvent[],
): Promise<void> {
  // Implementation...
}

// Fetch events from a server
export const getEvents = async (
  server: string,
  system: Models.PublicKey.PublicKey,
  ranges: Models.Ranges.RangesForSystem,
  moderationLevels?: Record<string, number>,
): Promise<Models.Events.Type> => {
  // Implementation...
};

// Various other API methods...
```

### Data Flow

#### Posting Content

When a user posts content:

1. The application calls `processHandle.post(content)`
2. The process handle creates an Event with the content
3. The event is signed using the system's private key
4. The signed event is ingested into the local store
5. The event is scheduled for synchronization with servers

#### Retrieving Content

To query content:

1. The application sets up a query
2. The query looks in local storage first
3. If data is missing, the query may trigger network requests
4. The callback is invoked with the current state
5. As more data arrives, the callback is called again with updated state

#### Synchronization

The synchronization process:

1. The application triggers synchronization with `synchronizationHint()`
2. The synchronizer checks for servers associated with the system
3. For each server, it gets the local state and queries the remote state
4. It requests missing events from the server
5. It uploads local events to the server

### API Reference

The library provides a comprehensive API for interacting with the protocol:

#### Creating a System

```typescript
// Create a new system
const metaStore = await MetaStore.createMetaStore(persistenceDriver);
const processHandle = await ProcessHandle.createProcessHandle(metaStore);

// Load an existing system
const activeStore = await metaStore.getActiveStore();
const store = await metaStore.openStore(
  activeStore.system,
  activeStore.version,
);
const processHandle = await ProcessHandle.load(store);
```

#### Profile Management

```typescript
// Set username
await processHandle.setUsername("alice");

// Set description
await processHandle.setDescription("Polycentric user");

// Set avatar
await processHandle.setAvatar(imageBundle);

// Set banner
await processHandle.setBanner(bannerImageBundle);
```

#### Social Graph

```typescript
// Follow a system
await processHandle.follow(otherSystem);

// Unfollow a system
await processHandle.unfollow(otherSystem);

// Block a system
await processHandle.block(otherSystem);

// Unblock a system
await processHandle.unblock(otherSystem);
```

#### Content Publishing

```typescript
// Post text content
await processHandle.post("Hello, Polycentric!");

// Post with an image
await processHandle.post("Check out this photo", imageManifest);

// Post with a reference (reply/quote)
await processHandle.post("Commenting on this", undefined, reference);

// Express an opinion (like/dislike)
await processHandle.opinion(postReference, Models.Opinion.OpinionLike);
```

#### Server Management

```typescript
// Add a server
await processHandle.addServer("https://server.example.com");

// Remove a server
await processHandle.removeServer("https://server.example.com");
```

### Common Usage Patterns

#### Setting Up a New Account

```typescript
// Create persistence driver
const persistenceDriver = PersistenceDriver.createPersistenceDriverMemory();

// Create meta store
const metaStore = await MetaStore.createMetaStore(persistenceDriver);

// Create process handle (user account)
const processHandle = await ProcessHandle.createProcessHandle(metaStore);

// Set as active account
await metaStore.setActiveStore(processHandle.system(), 0);

// Set up profile
await processHandle.setUsername("alice");
await processHandle.setDescription("Polycentric user");

// Add a server for synchronization
await processHandle.addServer("https://server.example.com");
```

#### Publishing and Synchronizing Content

```typescript
// Post content
const pointer = await processHandle.post("Hello, Polycentric!");

// Trigger synchronization
await processHandle.synchronizer.synchronizationHint();
```

#### Following Users and Viewing Content

```typescript
// Follow another user
await processHandle.follow(otherSystem);

// View their latest posts
processHandle.queryManager.queryLatest.query(
  otherSystem,
  [Models.ContentType.ContentTypePost],
  (state) => {
    // Display posts
  },
);
```

---

## Persistence Layer Details

The persistence layer in Polycentric is built on the `abstract-level` interface,
which provides an abstraction over key-value storage. This section details how
data is stored, indexed, and queried.

### Abstract Level Interface

The core storage type is `BinaryAbstractLevel`, which is defined as:

```typescript
export type BinaryAbstractLevel = AbstractLevel.AbstractLevel<
  Uint8Array,
  Uint8Array,
  Uint8Array
>;
```

This represents a key-value store where both keys and values are binary data
(`Uint8Array`). The library uses a custom transcoder to ensure binary data is
properly handled:

```typescript
export function deepCopyTranscoder(): LevelTranscoder.IEncoding<
  Uint8Array,
  Uint8Array,
  Uint8Array
> {
  return {
    name: "deepCopyTranscoder",
    format: "buffer",
    encode: (input: Uint8Array): Uint8Array => {
      const outputBuffer = new ArrayBuffer(input.length);
      const output = new Uint8Array(outputBuffer);
      output.set(input);
      return output;
    },
    decode: (buffer: Uint8Array): Uint8Array => {
      return buffer;
    },
  };
}
```

### Store and MetaStore

The `Store` class manages multiple indices, each handling a specific aspect of
the data:

```typescript
export class Store {
  private readonly level: PersistenceDriver.BinaryAbstractLevel;
  readonly indexEvents: IndexEvents;
  readonly indexSystemStates: IndexSystemState;
  readonly indexProcessStates: IndexProcessState;
  readonly indexEventsForSystemByTime: IndexEventsForSystemByTime;
  readonly indexOpinion: IndexOpinion;
  readonly indexCRDTElementSet: IndexCRDTElementSet;
  readonly indexFeed: IndexFeed;
  readonly indexSystemProcessContentTypeLogicalClock: IndexSystemProcessContentTypeClock;
  // ...
}
```

The `MetaStore` manages multiple stores, allowing for:

- Multiple systems (user accounts)
- Version tracking
- System state management

```typescript
export interface IMetaStore {
  openStore: (
    system: PublicKey,
    version: number,
  ) => Promise<BinaryAbstractLevel>;
  deleteStore: (system: PublicKey, version: number) => Promise<void>;
  listStores: () => Promise<StoreInfo[]>;
  setStoreReady: (system: PublicKey, version: number) => Promise<void>;
  setActiveStore: (system: PublicKey, version: number) => Promise<void>;
  unsetActiveStore: () => Promise<void>;
  getActiveStore: () => Promise<StoreInfo | undefined>;
}
```

### Index Implementation

The store contains multiple specialized indices. Here are some key examples:

#### IndexEvents

Stores raw events and provides retrieval by system, process, and logical clock:

```typescript
// Key structure for events
makeEventKey(
  system: Models.PublicKey.PublicKey,
  process: Models.Process.Process,
  logicalClock: Long,
): Uint8Array {
  return Util.concatBuffers([
    // System key
    new Uint8Array(system.keyType.toBytesBE()),
    system.key,
    // Process ID
    process.process,
    // Logical clock
    new Uint8Array(logicalClock.toBytesBE()),
  ]);
}
```

#### IndexCRDTElementSet

Manages CRDT element sets (follows, blocks, etc.):

```typescript
// Key structure for CRDT element sets
makeKey(
  system: Models.PublicKey.PublicKey,
  contentType: Models.ContentType.ContentType,
  value: Uint8Array,
): Uint8Array {
  return Util.concatBuffers([
    // System key
    new Uint8Array(system.keyType.toBytesBE()),
    system.key,
    // Content type
    new Uint8Array(contentType.toBytesBE()),
    // Value
    value,
  ]);
}
```

### Query Patterns

The persistence layer supports several query patterns:

#### Direct Lookup

Used for retrieving specific items by key:

```typescript
async getSignedEvent(
  system: Models.PublicKey.PublicKey,
  process: Models.Process.Process,
  logicalClock: Long,
): Promise<Models.SignedEvent.SignedEvent | undefined> {
  const key = this.makeEventKey(system, process, logicalClock);
  const value = await PersistenceDriver.tryLoadKey(this.events, key);

  if (value === undefined) {
    return undefined;
  }

  return Models.SignedEvent.fromBuffer(value);
}
```

#### Range Queries

Used for retrieving series of items:

```typescript
async query(
  system: Models.PublicKey.PublicKey,
  contentType: Models.ContentType.ContentType,
  after: Long | undefined,
  limit: number,
): Promise<Uint8Array[]> {
  const prefix = this.makePrefix(system, contentType);

  const result: Uint8Array[] = [];

  const start = after
    ? Util.concatBuffers([prefix, new Uint8Array(after.toBytesBE())])
    : prefix;

  // Inclusive start, exclusive end
  const end = Util.concatBuffers([prefix, Store.MAX_8BYTE_KEY]);

  let count = 0;

  for await (const [_key, value] of this.index.iterator({
    gte: start,
    lt: end,
    reverse: true,
    limit: limit,
  })) {
    result.push(value);
    count++;
  }

  return result;
}
```

#### Batch Operations

Used for atomic updates:

```typescript
// Example batch operation
const batchOperations: PersistenceDriver.BinaryUpdateLevel[] = [
  {
    type: "put",
    key: makeEventKey(system, process, logicalClock),
    value: signedEventBuffer,
  },
  {
    type: "put",
    key: makeIndexKey(system, contentType, logicalClock),
    value: eventPointerBuffer,
  },
];

await this.level.batch(batchOperations);
```

---

## React Native Port

### Overview and Strategy

The goal of the React Native port is to adapt the Polycentric Core library to
work efficiently in React Native applications while maintaining the same API and
functionality. The port focuses on:

1. Replacing browser-specific storage with React Native compatible storage
2. Optimizing networking for mobile environments
3. Enhancing performance for mobile devices
4. Maintaining API compatibility with the web version

The strategy is to make minimal changes to the core architecture and behavior,
focusing on the platform-specific adaptations needed for React Native.

### Required Changes

#### 1. Persistence Driver

The most significant change needed is implementing a React Native-compatible
persistence driver. The current implementation uses `abstract-level` and
`memory-level`, which need to be adapted for React Native's storage
capabilities.

#### 2. Networking Optimizations

The networking code uses `cross-fetch`, which should work in React Native but
might benefit from optimizations for mobile environments, such as:

- Connection awareness
- Retry logic
- Timeout handling
- Background synchronization

#### 3. Performance Optimizations

React Native has different performance characteristics compared to browsers:

- Limited memory
- Different threading model
- Background/foreground state transitions
- Power consumption considerations

### Implementation Details

#### 1. Persistence Driver Implementation

For React Native, we'll implement a persistence driver using React Native's
storage capabilities. Here's a recommended approach using MMKV:

```typescript
// Example implementation using React Native's MMKV
import { MMKV } from "react-native-mmkv";
import * as AbstractLevel from "abstract-level";
import * as LevelTranscoder from "level-transcoder";

class MMKVAbstractLevel extends AbstractLevel.AbstractLevel {
  private mmkv: MMKV;
  private prefix: string;

  constructor(
    prefix: string,
    options: {
      keyEncoding: LevelTranscoder.IEncoding<any, any, any>;
      valueEncoding: LevelTranscoder.IEncoding<any, any, any>;
    },
  ) {
    super(options);
    this.prefix = prefix;
    this.mmkv = new MMKV({ id: prefix });
  }

  // Implement abstract-level methods
  async _get(key: Uint8Array): Promise<Uint8Array> {
    const keyStr = this.encodeKey(key);
    const value = this.mmkv.getString(keyStr);
    if (value === undefined) {
      throw new Error("NotFoundError");
    }
    return this.decodeValue(value);
  }

  async _put(key: Uint8Array, value: Uint8Array): Promise<void> {
    const keyStr = this.encodeKey(key);
    const valueStr = this.encodeValue(value);
    this.mmkv.set(keyStr, valueStr);
  }

  async _del(key: Uint8Array): Promise<void> {
    const keyStr = this.encodeKey(key);
    this.mmkv.delete(keyStr);
  }

  async _batch(
    operations: Array<AbstractLevel.AbstractBatchOperation<this, any, any>>,
  ): Promise<void> {
    for (const op of operations) {
      if (op.type === "put") {
        await this._put(op.key, op.value);
      } else if (op.type === "del") {
        await this._del(op.key);
      }
    }
  }

  // Helper methods
  private encodeKey(key: Uint8Array): string {
    return Buffer.from(key).toString("base64");
  }

  private decodeValue(value: string): Uint8Array {
    return Buffer.from(value, "base64");
  }

  private encodeValue(value: Uint8Array): string {
    return Buffer.from(value).toString("base64");
  }

  // Other required methods...
}

export function createPersistenceDriverReactNative(): IPersistenceDriver {
  const getImplementationName = () => {
    return "ReactNative";
  };

  const openStore = async (path: string) => {
    return new MMKVAbstractLevel(path, {
      keyEncoding: deepCopyTranscoder(),
      valueEncoding: deepCopyTranscoder(),
    }) as BinaryAbstractLevel;
  };

  const estimateStorage = async () => {
    // React Native doesn't provide straightforward storage stats
    return {
      bytesAvailable: undefined,
      bytesUsed: undefined,
    };
  };

  const persisted = async () => {
    return true; // MMKV is persistent
  };

  const destroyStore = async (path: string) => {
    // Delete the MMKV instance with the given ID
    const mmkv = new MMKV({ id: path });
    mmkv.clearAll();
  };

  return {
    getImplementationName,
    openStore,
    estimateStorage,
    persisted,
    destroyStore,
  };
}
```

#### 2. Networking Enhancements

For React Native, we'll enhance the networking layer with mobile-specific
optimizations:

```typescript
// Enhanced fetch with connection awareness for React Native
import { Platform, NativeModules } from "react-native";
import NetInfo from "@react-native-community/netinfo";

async function enhancedFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  // Check for network connectivity first
  const networkState = await NetInfo.fetch();

  if (!networkState.isConnected) {
    throw new Error("No network connection available");
  }

  // Add timeout for mobile networks
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Then modify each API method to use enhancedFetch
export async function postEvents(
  server: string,
  events: Models.SignedEvent.SignedEvent[],
): Promise<void> {
  const response = await enhancedFetch(server + "/events", {
    method: "POST",
    headers: new Headers({
      "x-polycentric-user-agent": userAgent,
      "x-platform": Platform.OS,
    }),
    body: Protocol.Events.encode({
      events: events,
    }).finish(),
  });

  await checkResponse("postEvents", response);
}
```

#### 3. App State Management

React Native requires handling app state transitions:

```typescript
// src/synchronization-rn.ts
import { AppState } from "react-native";

// Optimize synchronization based on app state
export function setupAppStateSynchronization(processHandle) {
  AppState.addEventListener("change", (nextAppState) => {
    // When app comes to foreground, trigger synchronization
    if (nextAppState === "active") {
      processHandle.synchronizer.synchronizationHint();
    }
  });
}
```

### Testing and Validation

To ensure the React Native port works correctly, testing should focus on:

1. Storage persistence across app restarts
2. Network handling in various connectivity scenarios
3. Performance with large datasets
4. Cross-platform consistency between iOS and Android

## Implementation Plan

### Step-by-Step Approach

The implementation is divided into phases:

#### Phase 1: Environment Setup and Analysis

- Fork/branch the existing repository
- Set up a React Native test application
- Review all dependencies for React Native compatibility
- Create a compatibility table for dependencies

#### Phase 2: Core Persistence Implementation

- Create React Native implementation of `abstract-level` interface
- Implement React Native persistence driver
- Add binary data handling for React Native storage

#### Phase 3: Networking and API Adaptations

- Create network connectivity monitoring
- Implement timeout handling for mobile networks
- Add retry logic for intermittent connections
- Replace `cross-fetch` with enhanced fetch implementation

#### Phase 4: Cryptographic Optimizations (Optional)

- Benchmark cryptographic operations on React Native
- Create native modules for cryptographic operations if needed
- Implement fallback to JS implementation

#### Phase 5: Testing and Validation

- Adapt existing tests for React Native
- Create React Native-specific tests for storage
- Test networking in various connectivity scenarios
- Test with large datasets

#### Phase 6: Documentation and Examples

- Update documentation for React Native-specific APIs
- Create a simple React Native example app
- Create a migration guide

#### Phase 7: Deployment and Release

- Update package configuration for React Native
- Set up continuous integration
- Publish to npm

### Timeline and Milestones

| Phase                                | Estimated Time    |
| ------------------------------------ | ----------------- |
| Phase 1: Setup and Analysis          | 1 week            |
| Phase 2: Persistence Implementation  | 2 weeks           |
| Phase 3: Networking Adaptations      | 1 week            |
| Phase 4: Cryptographic Optimizations | 1-2 weeks         |
| Phase 5: Testing and Validation      | 2 weeks           |
| Phase 6: Documentation               | 1 week            |
| Phase 7: Deployment                  | 0.5 week          |
| **Total**                            | **8.5-9.5 weeks** |

### Success Criteria

The React Native port should meet these criteria:

1. **Functionality**: All tests pass on both iOS and Android
2. **API Compatibility**: Maintains the same API as the web version
3. **Performance**: Good performance on mobile devices
   - Startup time < 2 seconds
   - Posting latency < 500ms
   - Synchronization of 100 events < 5 seconds
4. **Persistence**: Data persists across app restarts
5. **Network Resilience**: Handles network interruptions gracefully

## Example Implementation

### Persistence Driver

Here's an example of how to implement the persistence driver using MMKV in a
React Native application:

```typescript
// persistence-driver-rn.ts
import { MMKV } from "react-native-mmkv";
import * as AbstractLevel from "abstract-level";
import * as LevelTranscoder from "level-transcoder";
import * as PersistenceDriver from "./persistence-driver";
import * as Util from "./util";

class MMKVAbstractLevel extends AbstractLevel.AbstractLevel {
  private mmkv: MMKV;
  private prefix: string;

  constructor(
    prefix: string,
    options: {
      keyEncoding: LevelTranscoder.IEncoding<any, any, any>;
      valueEncoding: LevelTranscoder.IEncoding<any, any, any>;
    },
  ) {
    super(options);
    this.prefix = prefix;
    this.mmkv = new MMKV({ id: prefix });
  }

  // Implementation of abstract-level methods...
}

// Export the React Native persistence driver
export function createPersistenceDriverReactNative(): PersistenceDriver.IPersistenceDriver {
  // Implementation...
}
```

### Integration Example

Here's how to use the library in a React Native application:

```typescript
// App.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Button } from 'react-native';
import * as Polycentric from '@polycentric/polycentric-core/react-native';
import { createPersistenceDriverReactNative } from './persistence-driver-rn';

function App() {
  const [processHandle, setProcessHandle] = useState(null);
  const [username, setUsername] = useState('');

  useEffect(() => {
    async function initialize() {
      // Create a persistence driver for React Native
      const persistenceDriver = createPersistenceDriverReactNative();

      // Create a meta store
      const metaStore = await Polycentric.MetaStore.createMetaStore(persistenceDriver);

      // Load existing account or create a new one
      let handle;
      const activeStore = await metaStore.getActiveStore();

      if (activeStore) {
        // Load existing account
        const store = await metaStore.openStore(activeStore.system, activeStore.version);
        handle = await Polycentric.ProcessHandle.load(store);
      } else {
        // Create a new account
        handle = await Polycentric.ProcessHandle.createProcessHandle(metaStore);

        // Set as active
        await metaStore.setActiveStore(handle.system(), 0);
      }

      setProcessHandle(handle);

      // Query username
      handle.queryManager.queryCRDT.query(
        handle.system(),
        Polycentric.Models.ContentType.ContentTypeUsername,
        (state) => {
          if (state.value) {
            setUsername(Polycentric.Util.decodeText(state.value));
          }
        }
      );
    }

    initialize();
  }, []);

  const updateUsername = async (newUsername) => {
    if (processHandle) {
      await processHandle.setUsername(newUsername);
      setUsername(newUsername);
    }
  };

  return (
    <View>
      <Text>Username: {username || 'Not set'}</Text>
      <Button
        title="Set Username"
        onPress={() => updateUsername('ReactNativeUser')}
      />
    </View>
  );
}

export default App;
```

---

## Conclusion

The Polycentric ecosystem provides a robust foundation for decentralized social
applications. The protocol defines the core data structures and behaviors, the
server provides the backend infrastructure, and the client libraries provide the
interface for applications.

Porting the Polycentric Core library to React Native involves adapting the
persistence layer, optimizing networking, and enhancing performance for mobile
environments. With the right implementation strategy, the port can maintain
compatibility with the web version while leveraging the unique capabilities of
React Native.

By following the implementation plan outlined in this document, developers can
create a fully-functional React Native port that integrates seamlessly with the
existing Polycentric ecosystem.
