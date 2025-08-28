# Polycentric DM Client

React components and hooks for integrating with the Polycentric DM server.

## Usage

### Basic Setup

```tsx
import { DMChatComponent } from '@polycentric/polycentric-react/lib/dm';
import { useProcessHandleManager } from '@polycentric/polycentric-react';

function MyDMComponent() {
  const { processHandle } = useProcessHandleManager();

  const dmConfig = {
    httpUrl: 'http://localhost:8080',
    websocketUrl: 'ws://localhost:8081',
  };

  const otherUser = /* Get the other user's public key */;

  return (
    <DMChatComponent
      otherParty={otherUser}
      otherPartyName="Alice"
      dmServerConfig={dmConfig}
      className="my-chat"
    />
  );
}
```

### Advanced Usage with Hook

```tsx
import {
  useDMClient,
  DMMessageContent,
} from '@polycentric/polycentric-react/lib/dm';

function CustomDMInterface() {
  const {
    client,
    isConnected,
    isRegistered,
    messages,
    error,
    sendMessage,
    loadHistory,
  } = useDMClient({
    config: {
      httpUrl: 'http://localhost:8080',
      websocketUrl: 'ws://localhost:8081',
    },
    autoConnect: true,
  });

  const handleSendText = async (text: string) => {
    const content: DMMessageContent = {
      type: 'text',
      text,
    };

    await sendMessage(otherUserPublicKey, content);
  };

  // Custom UI implementation
  return <div>{/* Your custom chat UI */}</div>;
}
```

### Manual Client Usage

```tsx
import { DMClient } from '@polycentric/polycentric-react/lib/dm';

// Initialize client
const client = new DMClient(dmConfig, processHandle);

// Register encryption keys
await client.generateAndRegisterKeys();

// Connect to WebSocket
await client.connectWebSocket();

// Send a message
await client.sendMessage(recipientPublicKey, {
  type: 'text',
  text: 'Hello, world!',
});

// Get message history
const history = await client.getHistory(otherPartyPublicKey);
```

## Security Features

- **End-to-End Encryption**: All messages are encrypted using X25519 + ChaCha20Poly1305
- **Identity Verification**: Uses existing Polycentric Ed25519 keys for authentication
- **Perfect Forward Secrecy**: Each message uses a unique ephemeral key
- **Signature Verification**: All messages are signed by the sender's identity key

## Message Types

The DM system supports several message types:

```tsx
interface DMMessageContent {
  type: 'text' | 'image' | 'file' | 'typing' | 'read_receipt';
  text?: string;
  file?: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    fileId: string;
  };
  typing?: {
    isTyping: boolean;
  };
  readReceipt?: {
    messageId: string;
    readTimestamp: Date;
  };
}
```

## Configuration

The DM client requires configuration pointing to your DM server:

```tsx
interface DMServerConfig {
  httpUrl: string; // HTTP API endpoint
  websocketUrl: string; // WebSocket endpoint for real-time messaging
}
```

## Error Handling

The components and hooks provide error states and handling:

```tsx
const { error, clearError } = useDMClient(config);

if (error) {
  return (
    <div>
      <p>Error: {error}</p>
      <button onClick={clearError}>Dismiss</button>
    </div>
  );
}
```

## Styling

The `DMChatComponent` uses CSS-in-JS for styling and accepts a `className` prop for custom styling:

```tsx
<DMChatComponent
  className="my-custom-chat-styles"
  // ... other props
/>
```

## Development Notes

- The encryption implementation in this example is a placeholder
- Real implementation would use libraries like `@noble/curves` for X25519
- Consider implementing message caching and offline support
- File uploads would require additional server endpoints
- Rate limiting should be implemented on the server side
