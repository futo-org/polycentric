# Polycentric Core - React Native Port Documentation

## Overview

This document provides a comprehensive overview of the Polycentric protocol
implementation and outlines the necessary changes to port it to React Native.
The Polycentric protocol is a decentralized social protocol that allows for
secure, distributed communication between nodes (devices) in a network.

## Architecture Overview

Polycentric Core is built as a modular system with several key components:

1. **Cryptographic Layer**: Uses Ed25519 for signatures and key management
2. **Persistence Layer**: Abstract storage interface with concrete
   implementations
3. **Protocol Definitions**: Data structures and message formats
4. **API Methods**: Network communication between nodes
5. **Process Handling**: Identity and state management
6. **Query System**: Data retrieval and synchronization
7. **Store**: Data indexing and storage management

## Core Components

### Cryptographic Operations

The cryptography is primarily handled through:

- `@noble/ed25519`: For Ed25519 signatures
- `@noble/hashes/sha512`: For SHA-512 hashing
- `fast-sha256`: For SHA-256 hashing

These libraries should be compatible with React Native without modification.

### Persistence Layer

The persistence mechanism uses an abstract interface (`IPersistenceDriver`) with
the following methods:

- `getImplementationName()`: Returns the storage type name
- `openStore(path)`: Opens a store at the given path
- `estimateStorage()`: Returns storage usage estimates
- `persisted()`: Checks if storage is persistent
- `destroyStore(path)`: Deletes a store

The codebase uses `abstract-level` for storage abstraction and `memory-level`
for an in-memory implementation. For React Native, we'll need to implement a
React Native-compatible persistence driver.

### Data Models

The codebase uses a comprehensive set of data models defined in
`models/index.ts`:

- `PublicKey`: Cryptographic identity management
- `PrivateKey`: Secret key management and signing
- `Process`: Process identity management
- `ContentType`: Content type definitions
- `Event`: Core data unit that flows through the system
- `SignedEvent`: Event with cryptographic signature
- `Pointer`: Reference to an event

### Process Management

The `ProcessHandle` class is the central interface for interacting with the
Polycentric system:

- Creates and manages cryptographic identities
- Posts content to the network
- Manages follows, blocks, and other social interactions
- Handles synchronization between devices

### Store System

The `Store` class manages the actual data storage with multiple indices:

- `IndexEvents`: Stores raw events
- `IndexSystemStates`: Tracks system states
- `IndexProcessStates`: Manages process states
- `IndexEventsForSystemByTime`: Time-based event indexing
- `IndexOpinion`: Opinion (like/dislike) tracking
- `IndexCRDTElementSet`: CRDT (Conflict-free Replicated Data Type) set
  operations
- `IndexFeed`: Feed generation and management

### API Methods

Network communication uses standard HTTP methods via `cross-fetch`:

- `postEvents`: Sends events to a server
- `getEvents`: Retrieves events from a server
- `getRanges`: Gets available data ranges
- `getQueryLatest`: Gets the latest events of specific types
- `getQueryIndex`: Pagination/index-based querying
- `getQueryReferences`: Gets referenced events

## React Native Port: Required Changes

### 1. Persistence Driver Implementation

The most significant change needed is a React Native-compatible persistence
driver. Instead of using `abstract-level` directly, we'll need a React Native
storage solution.

```typescript
// Example implementation using React Native's AsyncStorage
export function createPersistenceDriverReactNative(): IPersistenceDriver {
  const getImplementationName = () => {
    return "ReactNative";
  };

  const openStore = async (path: string) => {
    // Use an appropriate storage mechanism for React Native
    // Potentially AsyncStorage, React Native SQLite, or mmkv
    // This will require a custom implementation of the abstract-level interface
  };

  const estimateStorage = async () => {
    // Use React Native APIs to estimate storage
    return {
      bytesAvailable: undefined,
      bytesUsed: undefined,
    };
  };

  const persisted = async () => {
    return true; // React Native storage is typically persistent
  };

  const destroyStore = async (path: string) => {
    // Implementation to remove store data
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

### 2. Crypto Adaptations

While the cryptographic libraries should work in React Native, you might need to
ensure they're properly optimized:

- Consider using native modules for cryptographic operations if performance is
  an issue
- Ensure the libraries work properly in the React Native JavaScript environment

### 3. Networking Adjustments

The current implementation uses `cross-fetch`, which should work in React
Native. However, you might want to:

- Add timeout handling specific to mobile networks
- Add retry logic for mobile connectivity issues
- Consider connection state monitoring

### 4. Performance Optimizations

React Native has different performance characteristics compared to browsers:

- Consider limiting concurrent operations to avoid UI freezing
- Implement background processing for intensive operations
- Add progress indicators for long-running operations

### 5. Build Configuration

Update the build configuration in `package.json` to properly target React
Native:

```json
"scripts": {
  "build:rn": "esbuild src/index.ts --bundle --outfile=dist/polycentric-core.rn.js --format=cjs --platform=neutral",
}
```

## Implementation Strategy

1. **Start with persistence layer**: Implement a React Native storage driver
   first, as it's the foundation of everything else
2. **Test core functionality**: Ensure basic operations (creating identities,
   posting content) work properly
3. **Optimize for mobile**: Address any performance issues specific to mobile
   devices
4. **Test synchronization**: Ensure data properly syncs between devices in
   real-world mobile scenarios

## API Documentation

Here's a summary of the main APIs available to developers:

### Creating a Process Handle (User Identity)

```typescript
import * as Polycentric from "@polycentric/polycentric-core/react-native";

// Create a new user identity
const metaStore = await Polycentric.MetaStore.createMetaStore(
  Polycentric.PersistenceDriver.createPersistenceDriverReactNative(),
);
const processHandle =
  await Polycentric.ProcessHandle.createProcessHandle(metaStore);
```

### Posting Content

```typescript
// Post a simple text message
await processHandle.post("Hello, Polycentric!");

// Post with an image
await processHandle.post("Check out this photo", imageManifest);

// Post with a reference to another post
await processHandle.post("Commenting on this", undefined, reference);
```

### Social Actions

```typescript
// Follow another user
await processHandle.follow(otherUserSystem);

// Unfollow a user
await processHandle.unfollow(otherUserSystem);

// Block a user
await processHandle.block(userToBlockSystem);

// Like/react to content
await processHandle.opinion(postReference, Models.Opinion.OpinionLike);
```

### Profile Management

```typescript
// Set username
await processHandle.setUsername("alice");

// Set profile description
await processHandle.setDescription("Polycentric user");

// Set avatar
await processHandle.setAvatar(avatarImageBundle);

// Set banner
await processHandle.setBanner(bannerImageBundle);
```

### Server Management

```typescript
// Add a server for synchronization
await processHandle.addServer("https://example-server.com");

// Remove a server
await processHandle.removeServer("https://example-server.com");
```

### Synchronization

```typescript
// Start synchronization
processHandle.synchronizer.synchronizationHint();

// Full synchronization
await Polycentric.ProcessHandle.fullSync(processHandle);
```

### Queries

```typescript
// Get latest posts from a user
processHandle.queryManager.queryLatest.query(
  userSystem,
  [Models.ContentType.ContentTypePost],
  (events) => {
    // Process the events
  },
);

// Get a user's profile information
processHandle.queryManager.queryLatest.query(
  userSystem,
  [
    Models.ContentType.ContentTypeUsername,
    Models.ContentType.ContentTypeDescription,
    Models.ContentType.ContentTypeAvatar,
  ],
  (events) => {
    // Process profile info
  },
);
```

## Conclusion

The Polycentric Core library provides a comprehensive implementation of the
Polycentric protocol. Porting it to React Native primarily requires adapting the
persistence layer to use React Native-compatible storage solutions. The
cryptographic and networking layers should work with minimal changes, but may
require optimization for mobile performance characteristics.

By following the implementation strategy outlined above, you should be able to
create a fully-functional React Native port that maintains compatibility with
the existing Polycentric ecosystem.

