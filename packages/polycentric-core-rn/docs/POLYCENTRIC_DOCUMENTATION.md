# Polycentric Core Library Documentation

## Overview

Polycentric is a decentralized social protocol that enables secure, distributed
communication between nodes (devices) in a network. The protocol uses
cryptographic identities, content-addressed storage, and a robust
synchronization mechanism to create a resilient, censorship-resistant platform.

This documentation provides a comprehensive overview of the Polycentric Core
library's architecture, components, and usage patterns.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Architecture](#architecture)
3. [Key Components](#key-components)
4. [Data Flow](#data-flow)
5. [API Reference](#api-reference)
6. [Common Usage Patterns](#common-usage-patterns)
7. [Advanced Topics](#advanced-topics)

## Core Concepts

### System and Process

The protocol has two core identity concepts:

- **System**: Represents a user identity, associated with a public/private key
  pair
- **Process**: Represents a specific client application or device within a
  system

Each system can have multiple processes, allowing for multiple devices to
operate under the same identity.

### Events

The fundamental data unit in Polycentric is an **Event**. Events are signed
messages that represent various types of content:

- Posts
- Profile information (username, description, avatar)
- Social actions (follows, likes, etc.)
- Claims (identity verification)
- System metadata

Events are immutable and cryptographically signed, ensuring authenticity and
integrity.

### Content Types

Polycentric defines various content types for different kinds of data:

- `ContentTypePost`: Text posts with optional images
- `ContentTypeUsername`, `ContentTypeDescription`, `ContentTypeAvatar`: Profile
  information
- `ContentTypeFollow`, `ContentTypeBlock`: Social graph management
- `ContentTypeOpinion`: Likes/dislikes
- `ContentTypeClaim`: Identity verification claims
- Plus many others...

### CRDTs

Conflict-free Replicated Data Types (CRDTs) are used to manage state that can be
updated concurrently from multiple processes. Polycentric uses two types of
CRDTs:

- **LWW Element**: A simple last-write-wins register
- **LWW Element Set**: A set that supports add/remove operations

These allow for consistent state across devices even when updates occur offline.

## Architecture

The Polycentric Core library is organized in a layered architecture:

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

### Layer Responsibilities

1. **Persistence Driver**: Abstract interface for storage operations
2. **Store & Meta Store**: Data organization and indexing
3. **Protocol**: Data structures and message formats
4. **Queries & Synchronizer**: Data retrieval and network synchronization
5. **Process Handle**: User identity and operation management
6. **API Methods**: Network communication APIs

## Key Components

### Persistence Driver

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

The library includes a memory-based implementation:

```typescript
const driver = PersistenceDriver.createPersistenceDriverMemory();
```

### Meta Store

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

Usage:

```typescript
const metaStore = await MetaStore.createMetaStore(persistenceDriver);
```

### Store

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

Each index handles a specific aspect of the data:

- **IndexEvents**: Raw storage of events
- **IndexSystemStates**: System-level state
- **IndexProcessStates**: Process-level state
- And many others for specific query patterns

### Process Handle

The ProcessHandle is the main interface for interacting with the protocol:

```typescript
export class ProcessHandle {
  private readonly _processSecret: Models.ProcessSecret.ProcessSecret;
  private readonly _store: Store.Store;
  private readonly _system: Models.PublicKey.PublicKey;
  // ...

  public readonly queryManager: Queries.QueryManager.QueryManager;
  public readonly synchronizer: Synchronization.Synchronizer;

  // Various methods for interacting with the protocol
  // ...
}
```

It provides methods for:

- Creating and signing events
- Social graph management (follow, block)
- Content publishing (post, opinions)
- Profile management
- Server management
- And more...

### Queries

The query system provides various ways to retrieve data:

```typescript
// Query interface
export interface Query<T> {
  query: (
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
    handleUpdate: (state: T) => void,
  ) => QueryHandle;
}

// Query types
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

These provide different query patterns:

- Latest events of a specific type
- Events by index
- Events by cursor
- CRDT state
- And more...

### Synchronization

The Synchronizer handles data synchronization between devices:

```typescript
export class Synchronizer {
  private readonly _processHandle: ProcessHandle.ProcessHandle;
  private _synchronizationTask: Util.OnceFlag;
  // ...

  public synchronizationHint(): Promise<void> {
    // Trigger synchronization
  }

  public debugWaitUntilSynchronizationComplete(): Promise<void> {
    // Wait for synchronization to complete (for testing)
  }
  // ...
}
```

It manages:

- Retrieving ranges of data from servers
- Comparing local and remote state
- Fetching missing events
- Uploading local events

### API Methods

The API methods provide network communication:

```typescript
// Fetch events from a server
export const getEvents: GetEventsType = async (
  server: string,
  system: Models.PublicKey.PublicKey,
  ranges: Models.Ranges.RangesForSystem,
  moderationLevels?: Record<string, number>,
): Promise<Models.Events.Type> => {
  // Implementation...
};

// Post events to a server
export async function postEvents(
  server: string,
  events: Models.SignedEvent.SignedEvent[],
): Promise<void> {
  // Implementation...
}

// Many other API methods...
```

## Data Flow

### Posting Content

When a user posts content, the flow is:

1. The application calls `processHandle.post(content)`.
2. The process handle creates an Event with the content.
3. The event is signed using the system's private key.
4. The signed event is ingested into the local store.
5. The event is scheduled for synchronization with servers.

```typescript
// Post content
const pointer = await processHandle.post("Hello, Polycentric!");

// The post is stored locally and scheduled for sync
await processHandle.synchronizer.synchronizationHint();
```

### Retrieving Content

To query content:

1. The application sets up a query.
2. The query looks in local storage first.
3. If data is missing, the query may trigger network requests.
4. The callback is invoked with the current state.
5. As more data arrives, the callback is called again with updated state.

```typescript
// Query for a user's posts
processHandle.queryManager.queryLatest.query(
  userSystem,
  [Models.ContentType.ContentTypePost],
  (events) => {
    // Process the latest posts
    console.log("Received posts:", events);
  },
);
```

### Synchronization

The synchronization process:

1. The application triggers synchronization with `synchronizationHint()`.
2. The synchronizer checks for servers associated with the system.
3. For each server, it gets the local state and queries the remote state.
4. It requests missing events from the server.
5. It uploads local events to the server.

```typescript
// Trigger synchronization
await processHandle.synchronizer.synchronizationHint();
```

## API Reference

### Creating a System

```typescript
// Create a new system
const metaStore = await MetaStore.createMetaStore(persistenceDriver);
const processHandle = await ProcessHandle.createProcessHandle(metaStore);

// Load an existing system
const stores = await metaStore.listStores();
const activeStore = await metaStore.getActiveStore();
const store = await metaStore.openStore(
  activeStore.system,
  activeStore.version,
);
const processHandle = await ProcessHandle.load(store);
```

### Profile Management

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

### Social Graph

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

### Content Publishing

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

### Identity Verification

```typescript
// Claim a social media identity
await processHandle.claim(Models.claimTwitter("username"));

// Vouch for another user's claim
await processHandle.vouch(claimPointer);
```

### Server Management

```typescript
// Add a server
await processHandle.addServer("https://server.example.com");

// Remove a server
await processHandle.removeServer("https://server.example.com");
```

### Querying Data

```typescript
// Query CRDT data (username, description, etc.)
processHandle.queryManager.queryCRDT.query(
  system,
  Models.ContentType.ContentTypeUsername,
  (state) => {
    if (state.value) {
      const username = Util.decodeText(state.value);
      console.log("Username:", username);
    }
  },
);

// Query latest posts
processHandle.queryManager.queryLatest.query(
  system,
  [Models.ContentType.ContentTypePost],
  (state) => {
    console.log("Posts:", state);
  },
);

// Query follows
processHandle.queryManager.queryCRDTSet.query(
  system,
  Models.ContentType.ContentTypeFollow,
  (state) => {
    console.log("Follows:", state);
  },
);
```

## Common Usage Patterns

### Setting Up a New Account

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

### Publishing and Synchronizing Content

```typescript
// Post content
const pointer = await processHandle.post("Hello, Polycentric!");

// Trigger synchronization
await processHandle.synchronizer.synchronizationHint();
```

### Following Users and Viewing Content

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

### Creating a Feed

```typescript
// Get systems the user follows
const follows = await new Promise<Models.PublicKey.PublicKey[]>((resolve) => {
  processHandle.queryManager.queryCRDTSet.query(
    processHandle.system(),
    Models.ContentType.ContentTypeFollow,
    (state) => {
      const followedSystems = state.added.map((item) => {
        return Models.PublicKey.fromBuffer(item.value);
      });
      resolve(followedSystems);
    },
  );
});

// Query posts from followed systems
for (const system of follows) {
  processHandle.queryManager.queryLatest.query(
    system,
    [Models.ContentType.ContentTypePost],
    (state) => {
      // Add posts to feed
    },
  );
}
```

## Advanced Topics

### Multi-Process Systems

A system can have multiple processes (e.g., multiple devices):

```typescript
// Create a new process for an existing system
const newProcessHandle = await ProcessHandle.createProcessHandleFromKey(
  metaStore,
  existingPrivateKey,
);
```

Each process can independently post content and sync with servers, maintaining
the same user identity.

### Cryptographic Verification

The library implements cryptographic verification of content:

```typescript
// Verify a signature
const isValid = Models.PublicKey.verify(publicKey, signature, message);
```

Events are verified during ingestion to ensure they're properly signed.

### Conflict Resolution

Polycentric uses CRDTs for automatic conflict resolution:

1. **Last Write Wins (LWW) Register**: For single-value data (username,
   description)
2. **LWW Element Set**: For set data (follows, blocks)

This allows multiple devices to make changes concurrently without conflicts.

### Data Persistence

The store indices maintain persistence of:

- Events
- System state
- Process state
- Social graph
- Content references

Each index has specialized storage patterns optimized for its query patterns.

---

This documentation provides a comprehensive overview of the Polycentric Core
library. For more detailed information on specific components, refer to the
source code and inline documentation.

