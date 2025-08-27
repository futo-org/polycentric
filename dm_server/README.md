# Polycentric DM Server

A secure, end-to-end encrypted direct messaging server for Polycentric identities.

## Features

- **End-to-End Encryption**: Uses X25519 key exchange with ChaCha20Poly1305 encryption
- **Polycentric Identity Integration**: Authenticates using Ed25519 signatures from existing Polycentric identities
- **Real-time Messaging**: WebSocket connections for instant message delivery
- **Minimal Metadata Storage**: Only stores encrypted messages, timestamps, and routing information
- **Message History**: Paginated message history API
- **Read Receipts**: Track message delivery and read status
- **Typing Indicators**: Real-time typing status (optional)

## Architecture

The DM server operates separately from the main Polycentric protocol server and forum server. It:

1. **Identity Verification**: Uses existing Polycentric Ed25519 identity keys for authentication
2. **Key Exchange**: Users register X25519 public keys for encryption (signed by their identity keys)
3. **Message Encryption**: Each message uses an ephemeral X25519 keypair for perfect forward secrecy
4. **Real-time Delivery**: WebSocket connections deliver messages instantly to online users
5. **Persistence**: Encrypted messages are stored with minimal metadata for offline delivery

## Security Model

- **Identity Authentication**: Challenge-response using Ed25519 signatures
- **Message Encryption**: X25519 ECDH + ChaCha20Poly1305 AEAD
- **Forward Secrecy**: Each message uses a unique ephemeral key
- **Metadata Minimization**: Server only sees encrypted content and routing info
- **No Key Escrow**: Server never has access to decryption keys

## API Endpoints

### Authentication
- `GET /challenge` - Get authentication challenge
- Authentication header: `Authorization: Bearer <base64-encoded-auth-request>`

### Key Management
- `POST /register_key` - Register X25519 public key for DM encryption
- `POST /get_key` - Get another user's X25519 public key

### Messaging
- `POST /send` - Send an encrypted direct message
- `POST /history` - Get DM history with another user
- `GET /conversations` - Get list of conversations
- `POST /mark_read` - Mark messages as read

### WebSocket
- Connect to `ws://localhost:8081` for real-time messaging
- Authentication required via challenge-response

## Setup

1. **Database Setup**:
   ```bash
   createdb dm_server
   ```

2. **Configuration**:
   ```bash
   cp example.env .env
   # Edit .env with your database URL and other settings
   ```

3. **Run Server**:
   ```bash
   cargo run
   ```

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `DM_SERVER_PORT` - HTTP API port (default: 8080)
- `DM_WEBSOCKET_PORT` - WebSocket port (default: 8081)
- `DM_CHALLENGE_KEY` - Secret key for challenge generation
- `DM_MAX_MESSAGE_SIZE` - Maximum message size in bytes (default: 1MB)
- `DM_MESSAGE_RETENTION_DAYS` - How long to keep messages (default: 30 days)
- `DM_MAX_CONNECTIONS_PER_USER` - Max WebSocket connections per user (default: 5)

## Message Flow

1. **Registration**: User registers X25519 public key signed by identity key
2. **Key Discovery**: Sender fetches recipient's X25519 public key
3. **Encryption**: Sender generates ephemeral keypair and encrypts message
4. **Transmission**: Encrypted message sent via API with sender's signature
5. **Delivery**: Server routes to recipient's WebSocket connections
6. **Decryption**: Recipient uses their X25519 private key to decrypt

## Client Integration

See the React client example in `../packages/polycentric-react/src/lib/dm/` for integration patterns.

## Development

```bash
# Run tests
cargo test

# Check code
cargo clippy

# Format code
cargo fmt
```

## Security Considerations

- Always use TLS in production
- Rotate challenge keys regularly
- Monitor for unusual connection patterns
- Implement rate limiting at the proxy level
- Regular database cleanup of old messages
- Consider implementing perfect forward secrecy key rotation
