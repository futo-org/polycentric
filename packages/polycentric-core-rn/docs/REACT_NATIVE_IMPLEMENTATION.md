# React Native Implementation Guide for Polycentric

This document outlines the specific implementation details for porting the
Polycentric Core library to React Native.

## Key Components Requiring Modification

### 1. Persistence Driver

The most significant change needed is implementing a React Native-compatible
persistence driver.

#### Current Implementation (Memory-only)

```typescript
// src/persistence-driver.ts
export function createPersistenceDriverMemory(): IPersistenceDriver {
  const getImplementationName = () => {
    return "Memory";
  };

  const openStore = async () => {
    return new MemoryLevel.MemoryLevel<Uint8Array, Uint8Array>({
      keyEncoding: deepCopyTranscoder(),
      valueEncoding: deepCopyTranscoder(),
    }) as BinaryAbstractLevel;
  };

  const estimateStorage = async () => {
    return {
      bytesAvailable: undefined,
      bytesUsed: undefined,
    };
  };

  const persisted = async () => {
    return false;
  };

  const destroyStore = async () => {};

  return {
    getImplementationName: getImplementationName,
    openStore: openStore,
    estimateStorage: estimateStorage,
    persisted: persisted,
    destroyStore: destroyStore,
  };
}
```

#### Proposed React Native Implementation

For React Native, we need a persistence implementation that uses React Native's
storage capabilities. We have several options:

1. **MMKV**: Fast, efficient key-value storage with native modules
2. **SQLite**: More powerful relational database
3. **AsyncStorage**: Simple key-value storage

MMKV is recommended for its performance and compatibility with binary data.

```typescript
// src/persistence-driver-rn.ts
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

  // Helper methods to convert between Uint8Array and string
  private encodeKey(key: Uint8Array): string {
    return Buffer.from(key).toString("base64");
  }

  private decodeValue(value: string): Uint8Array {
    return Buffer.from(value, "base64");
  }

  private encodeValue(value: Uint8Array): string {
    return Buffer.from(value).toString("base64");
  }

  // Implement other required methods...
  sublevel(
    prefix: string,
    options?: any,
  ): AbstractLevel.AbstractSublevel<this, any, any, any> {
    // Create a sublevel with a combined prefix
    // Implementation depends on how you want to handle sublevels
    return new MMKVAbstractSublevel(this, `${this.prefix}_${prefix}`, options);
  }

  // Implement other required AbstractLevel methods...
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
    // Could use native modules to get this information if needed
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

### 2. Networking Optimizations

The networking code uses `cross-fetch`, which should work in React Native but
might benefit from some optimizations:

```typescript
// src/api-methods-rn.ts
import { Platform, NativeModules } from "react-native";
import NetInfo from "@react-native-community/netinfo";

// Enhanced fetch with connection awareness for React Native
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

// Then modify each API method to use enhancedFetch instead of fetch
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

// Similar modifications for other API methods
```

### 3. Performance Optimizations

React Native runs in a JavaScript environment that differs from browsers, so we
should add some performance optimizations:

```typescript
// src/synchronization-rn.ts
import { AppState } from "react-native";
import { synchronizationHint } from "./synchronization";

// Optimize synchronization based on app state
export function setupAppStateSynchronization(processHandle) {
  AppState.addEventListener("change", (nextAppState) => {
    // When app comes to foreground, trigger synchronization
    if (nextAppState === "active") {
      processHandle.synchronizer.synchronizationHint();
    }
  });
}

// Optional: Add batch size limitations for mobile
export async function optimizedSynchronization(processHandle) {
  // Limit batch sizes for mobile
  const MOBILE_BATCH_SIZE = 50;

  // Implementation that respects mobile constraints
  // ...
}
```

### 4. Crypto Optimizations

While the crypto libraries should work in React Native, you might want to
optimize performance with native modules:

```typescript
// src/models/crypto-native.ts
import { NativeModules } from "react-native";

// Check if native crypto module is available
const hasNativeCrypto = NativeModules.PolycentricCrypto !== undefined;

export async function sign(
  privateKey: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  if (hasNativeCrypto) {
    // Use native implementation if available
    return await NativeModules.PolycentricCrypto.ed25519Sign(
      Buffer.from(privateKey).toString("base64"),
      Buffer.from(message).toString("base64"),
    );
  } else {
    // Fall back to JS implementation
    return await Ed.sign(message, privateKey);
  }
}

export async function verify(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  if (hasNativeCrypto) {
    // Use native implementation if available
    return await NativeModules.PolycentricCrypto.ed25519Verify(
      Buffer.from(publicKey).toString("base64"),
      Buffer.from(signature).toString("base64"),
      Buffer.from(message).toString("base64"),
    );
  } else {
    // Fall back to JS implementation
    return Ed.sync.verify(signature, message, publicKey);
  }
}
```

## Integration Steps

1. Create a new React Native module that implements the native crypto operations
   (optional)
2. Implement the React Native persistence driver using MMKV
3. Enhance the networking layer with React Native optimizations
4. Add performance optimizations for mobile environments

## Example Usage

Here's how the React Native port would be used in a React Native application:

```typescript
import * as Polycentric from "@polycentric/polycentric-core/react-native";

// Initialize the library
const initializePolycentric = async () => {
  // Create a persistence driver for React Native
  const persistenceDriver =
    Polycentric.PersistenceDriver.createPersistenceDriverReactNative();

  // Create a meta store
  const metaStore =
    await Polycentric.MetaStore.createMetaStore(persistenceDriver);

  // Load existing account or create a new one
  let processHandle;
  const activeStore = await metaStore.getActiveStore();

  if (activeStore) {
    // Load existing account
    const store = await metaStore.openStore(
      activeStore.system,
      activeStore.version,
    );
    processHandle = await Polycentric.ProcessHandle.load(store);
  } else {
    // Create a new account
    processHandle =
      await Polycentric.ProcessHandle.createProcessHandle(metaStore);

    // Set as active
    await metaStore.setActiveStore(processHandle.system(), 0);
  }

  // Setup optimizations for React Native
  setupAppStateSynchronization(processHandle);

  return processHandle;
};

// Use in a component
function ProfileScreen() {
  const [processHandle, setProcessHandle] = useState(null);
  const [username, setUsername] = useState("");

  useEffect(() => {
    initializePolycentric().then((handle) => {
      setProcessHandle(handle);

      // Query username
      handle.queryManager.queryCRDT.query(
        handle.system(),
        Polycentric.Models.ContentType.ContentTypeUsername,
        (state) => {
          if (state.value) {
            setUsername(Polycentric.Util.decodeText(state.value));
          }
        },
      );
    });
  }, []);

  const updateUsername = async (newUsername) => {
    if (processHandle) {
      await processHandle.setUsername(newUsername);
      setUsername(newUsername);
    }
  };

  // Component JSX...
}
```

## Testing

To validate the React Native port, create test cases that verify:

1. Storage persistence across app restarts
2. Cryptographic operations
3. Network operations in various connectivity scenarios
4. Performance with large datasets

These tests should be run on both iOS and Android devices to ensure
cross-platform compatibility.

