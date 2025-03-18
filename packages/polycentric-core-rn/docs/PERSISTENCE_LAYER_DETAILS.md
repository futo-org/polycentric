# Polycentric Persistence Layer Technical Details

This document provides a deep dive into the persistence layer of the Polycentric
Core library, focusing on how data is stored, indexed, and retrieved.
Understanding this layer is critical for implementing a React Native port.

## Overview

The persistence layer in Polycentric is built on the `abstract-level` interface,
which provides an abstraction over key-value storage. The library uses this
abstraction to implement a complex, multi-layered storage system with multiple
indices for efficient data retrieval.

```
┌─────────────────────────────────────────────┐
│                Store                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │IndexEvents│IndexSystem│IndexProcess│ ...  │
│  └─────────┘ └─────────┘ └─────────┘        │
├─────────────────────────────────────────────┤
│         Persistence Driver                   │
│  ┌─────────────────────────────────────────┐ │
│  │          BinaryAbstractLevel             │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Core Components

### Persistence Driver Interface

The `IPersistenceDriver` interface defines the contract for storage
implementations:

```typescript
export interface IPersistenceDriver {
  getImplementationName: () => string;
  openStore: (path: string) => Promise<BinaryAbstractLevel>;
  estimateStorage: () => Promise<StorageEstimate>;
  persisted: () => Promise<boolean>;
  destroyStore: (path: string) => Promise<void>;
}
```

The library includes a memory-based implementation, but other implementations
could use IndexedDB, SQLite, or other storage engines.

### BinaryAbstractLevel

The core storage type is `BinaryAbstractLevel`, which is defined as:

```typescript
export type BinaryAbstractLevel = AbstractLevel.AbstractLevel<
  Uint8Array,
  Uint8Array,
  Uint8Array
>;
```

This represents a key-value store where both keys and values are binary data
(`Uint8Array`).

### Store Class

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

### MetaStore

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

## Data Storage Details

### Key Structure

The library uses structured binary keys for efficient storage and retrieval:

```typescript
// Example of a system state key
export function makeSystemStateKey(system: PublicKey): Uint8Array {
  return Util.concatBuffers([
    new Uint8Array(system.keyType.toBytesBE()),
    system.key,
  ]);
}
```

### Store Sublevel Pattern

The store uses named sublevels to separate different types of data:

```typescript
const registerSublevel = (prefix: string) => {
  if (sublevels.has(prefix)) {
    throw Error("conflicting sublevel prefix");
  }

  const sublevel = this.level.sublevel(prefix, {
    keyEncoding: PersistenceDriver.deepCopyTranscoder(),
    valueEncoding: PersistenceDriver.deepCopyTranscoder(),
  }) as PersistenceDriver.BinaryAbstractSubLevel;

  sublevels.add(prefix);

  return sublevel;
};
```

Each index uses a unique prefix for its data.

### Transcoding

The library uses a custom transcoder to ensure binary data is properly copied:

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

This ensures that binary data is not accidentally shared or modified.

## Index Implementations

The store contains multiple specialized indices. Let's examine the key ones:

### IndexEvents

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

### IndexSystemStates

Tracks the state of systems:

```typescript
// Key structure for system states
makeSystemStateKey(system: Models.PublicKey.PublicKey): Uint8Array {
  return Store.makeSystemStateKey(system);
}
```

### IndexProcessStates

Tracks the state of processes:

```typescript
// Key structure for process states
makeProcessStateKey(
  system: Models.PublicKey.PublicKey,
  process: Models.Process.Process,
): Uint8Array {
  return Util.concatBuffers([
    // System key
    new Uint8Array(system.keyType.toBytesBE()),
    system.key,
    // Process ID
    process.process,
  ]);
}
```

### IndexCRDTElementSet

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

## Data Ingestion Flow

When data is ingested into the store:

1. The `ingest` method is called with a signed event
2. Each index processes the event and generates storage operations
3. All operations are executed as a batch for atomicity

```typescript
public async ingest(
  signedEvent: Models.SignedEvent.SignedEvent,
): Promise<void> {
  const actions: PersistenceDriver.BinaryUpdateLevel[] = [];

  for (const stage of this.stages) {
    actions.push(...(await stage.ingest(signedEvent)));
  }

  await this.level.batch(actions);
}
```

## Query Patterns

The persistence layer supports several query patterns:

### Direct Lookup

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

### Range Queries

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

### Batch Operations

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

## Implementing for React Native

To implement the persistence layer for React Native, you'll need to:

1. Create a React Native implementation of `IPersistenceDriver`
2. Implement the `BinaryAbstractLevel` interface using React Native storage
3. Handle binary data appropriately in the React Native environment

### Key Requirements

Your React Native implementation must:

1. **Store binary data**: Both keys and values are `Uint8Array`
2. **Support batch operations**: For atomic updates
3. **Support efficient range queries**: For retrieving series of items
4. **Persist data**: Data should survive app restarts
5. **Support sublevels**: For organizing different types of data

### Example Implementation Strategy

For React Native, you could use:

1. **MMKV**: For efficient key-value storage
2. **React Native SQLite**: For more complex query patterns
3. **Custom encoding**: To handle binary data in React Native storage

Each approach has tradeoffs:

- **MMKV**: Fastest, but limited query capabilities
- **SQLite**: More powerful queries, but more complex implementation
- **AsyncStorage**: Simplest, but slowest and limited size

For optimal performance and capabilities, a hybrid approach might work best:

- Use MMKV for direct lookups and small range queries
- Use SQLite for complex range queries and large datasets

## Conclusion

The persistence layer in Polycentric is a sophisticated system with multiple
indices and query patterns. Understanding these details is essential for
implementing a React Native port that maintains compatibility with the existing
library.

The key challenge will be implementing the `BinaryAbstractLevel` interface
efficiently using React Native storage options, while preserving the current API
and behavior to ensure cross-platform compatibility.

