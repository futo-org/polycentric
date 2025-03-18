# Polycentric Core for React Native

This package provides a React Native implementation of the Polycentric protocol, a decentralized social protocol that enables secure, distributed communication between nodes in a network.

## Installation

```bash
npm install @polycentric/polycentric-core/react-native
```

### Additional Dependencies

This package requires `react-native-mmkv` for persistent storage:

```bash
npm install react-native-mmkv
```

## Basic Usage

```typescript
import * as Polycentric from '@polycentric/polycentric-core/react-native';

// Create a process handle with React Native storage
const initializePolycentric = async () => {
  try {
    // Create a new process handle
    const processHandle = await Polycentric.createRNProcessHandle();
    
    // Set up profile information
    await processHandle.setUsername('ReactNativeUser');
    await processHandle.setDescription('Using Polycentric on React Native');
    
    // Add a server for synchronization
    await processHandle.addServer('https://your-server.com');
    
    return processHandle;
  } catch (error) {
    console.error('Error initializing Polycentric:', error);
    throw error;
  }
};

// Post content
const postContent = async (processHandle, content) => {
  try {
    const pointer = await processHandle.post(content);
    
    // Trigger synchronization
    await processHandle.synchronizer.synchronizationHint();
    
    return pointer;
  } catch (error) {
    console.error('Error posting content:', error);
    throw error;
  }
};

// Query data
const getUserProfile = async (processHandle, system) => {
  return new Promise((resolve) => {
    const profile = {};
    
    // Query username
    processHandle.queryManager.queryCRDT.query(
      system,
      Polycentric.Models.ContentType.ContentTypeUsername,
      (state) => {
        if (state.value) {
          profile.username = Polycentric.Util.decodeText(state.value);
        }
        checkComplete();
      }
    );
    
    // Query description
    processHandle.queryManager.queryCRDT.query(
      system,
      Polycentric.Models.ContentType.ContentTypeDescription,
      (state) => {
        if (state.value) {
          profile.description = Polycentric.Util.decodeText(state.value);
        }
        checkComplete();
      }
    );
    
    let completed = 0;
    function checkComplete() {
      completed++;
      if (completed >= 2) {
        resolve(profile);
      }
    }
  });
};
```

## React Native Specific Features

This React Native implementation includes:

1. **Persistent Storage**: Uses MMKV for efficient, persistent local storage
2. **Network Resilience**: Implements timeouts and automatic retries for network requests
3. **Performance Optimizations**: Optimized for mobile device constraints
4. **Simplified API**: Includes helper functions like `createRNProcessHandle()` for easier setup

## API Reference

### Core Functions

- `createRNProcessHandle()`: Creates a process handle with React Native storage
- `ProcessHandle.post(content)`: Post content to the network
- `ProcessHandle.setUsername(username)`: Set your username
- `ProcessHandle.setDescription(description)`: Set your profile description
- `ProcessHandle.follow(system)`: Follow another user
- `ProcessHandle.block(system)`: Block another user
- `ProcessHandle.opinion(reference, opinion)`: Express an opinion on content (like/dislike)
- `ProcessHandle.addServer(server)`: Add a server for synchronization
- `ProcessHandle.synchronizer.synchronizationHint()`: Trigger synchronization

### Query System

The query system provides reactive access to data:

```typescript
// Query latest posts
processHandle.queryManager.queryLatest.query(
  system,
  [Polycentric.Models.ContentType.ContentTypePost],
  (state) => {
    // Handle updated posts
    console.log('Posts:', state);
  }
);

// Query CRDT data (username, description, etc.)
processHandle.queryManager.queryCRDT.query(
  system,
  Polycentric.Models.ContentType.ContentTypeUsername,
  (state) => {
    if (state.value) {
      console.log('Username:', Polycentric.Util.decodeText(state.value));
    }
  }
);
```

## Implementation Details

The React Native port uses:

- **MMKV**: For efficient, persistent key-value storage
- **Enhanced Networking**: Timeout handling and retry logic for mobile networks
- **Optimized Build**: Uses platform-neutral bundle format for React Native compatibility

## License

[License details go here]