# DM Server Test Suite

Comprehensive test suite for the Polycentric DM server covering all major functionality.

## Test Structure

### Unit Tests

#### `crypto_tests.rs`
- **X25519 Key Generation**: Tests ephemeral and static key generation
- **Ed25519 Signatures**: Tests signing and verification with identity keys
- **Message Encryption/Decryption**: Tests end-to-end encryption with ChaCha20Poly1305
- **Key Conversions**: Tests byte array conversions for keys
- **Error Handling**: Tests invalid keys, wrong lengths, etc.
- **Cross-key Encryption**: Tests multiple sender-recipient pairs

#### `db_tests.rs`
- **User Key Management**: Registration and retrieval of X25519 keys
- **Message Storage**: Storing and retrieving encrypted messages
- **Message History**: Pagination and bidirectional conversation history
- **Delivery Tracking**: Message delivery and read status
- **Connection Management**: WebSocket connection registration and cleanup
- **Conversation Lists**: Most recent conversations per user
- **Cleanup Operations**: Stale connection and old message cleanup

#### `auth_tests.rs`
- **Challenge Generation**: HMAC-signed challenge creation
- **Authentication Flow**: Complete challenge-response verification
- **Signature Verification**: Ed25519 signature validation
- **Error Conditions**: Invalid HMAC, expired challenges, wrong signatures
- **Header Extraction**: Authorization header parsing and validation

#### `websocket_tests.rs`
- **Connection Management**: Registration and unregistration of WebSocket connections
- **Message Routing**: Sending messages to specific users and connections
- **Broadcasting**: Messages to all connected users
- **Message Types**: DM messages, typing indicators, read receipts, errors
- **Connection Statistics**: User counts and online status

### API Tests

#### `api_tests.rs`
- **X25519 Key Registration**: POST /register_key endpoint
- **Key Retrieval**: POST /get_key endpoint 
- **Message Sending**: POST /send endpoint with validation
- **Message History**: POST /history endpoint with pagination
- **Conversation Lists**: GET /conversations endpoint
- **Authentication**: Authorization header validation across endpoints
- **Error Handling**: Invalid signatures, missing recipients, duplicate messages
- **Size Validation**: Message size limits, key length validation

### Integration Tests

#### `integration_tests.rs`
- **Full Message Flow**: Complete end-to-end message sending and receiving
- **WebSocket Delivery**: Real-time message delivery to connected clients
- **Multi-user Scenarios**: Alice-Bob conversation flows
- **Message Decryption**: Verification that recipients can decrypt messages
- **Delivery Tracking**: Message delivered/read status updates
- **Multiple Device Support**: User with multiple WebSocket connections
- **Connection Cleanup**: Stale connection removal
- **Message Pagination**: Large conversation handling

## Running Tests

### Prerequisites

1. **Test Database**: Set up a PostgreSQL test database
   ```bash
   createdb dm_server_test
   export TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/dm_server_test"
   ```

2. **Dependencies**: Ensure all dependencies are installed
   ```bash
   cd dm_server
   cargo build
   ```

### Running All Tests

```bash
# Run all tests
cargo test

# Run with output
cargo test -- --nocapture

# Run specific test module
cargo test crypto_tests
cargo test db_tests
cargo test auth_tests
cargo test api_tests
cargo test websocket_tests
cargo test integration_tests
```

### Running Individual Tests

```bash
# Run specific test
cargo test test_message_encryption_decryption

# Run tests matching pattern
cargo test test_websocket

# Run with debug output
RUST_LOG=debug cargo test test_full_message_flow -- --nocapture
```

## Test Configuration

### Environment Variables

```bash
# Test database (required)
export TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/dm_server_test"

# Optional logging
export RUST_LOG=debug
```

### Test Database Setup

The tests automatically:
- Connect to the test database
- Run migrations to set up schema
- Clean up data between tests using `TRUNCATE`

Each test gets a fresh database state.

## Test Coverage

### Functionality Coverage

- ✅ **Cryptography**: Key generation, encryption, signing, verification
- ✅ **Database Operations**: All CRUD operations for users, messages, connections
- ✅ **Authentication**: Challenge-response, signature verification, headers
- ✅ **WebSocket Management**: Connection lifecycle, message routing
- ✅ **API Endpoints**: All HTTP endpoints with success and error cases
- ✅ **Message Flow**: End-to-end message sending and receiving
- ✅ **Multi-user Scenarios**: Complex conversation flows
- ✅ **Error Handling**: Invalid inputs, missing data, authentication failures

### Security Testing

- ✅ **Authentication Bypass**: Tests unauthorized access attempts
- ✅ **Signature Verification**: Tests invalid and forged signatures
- ✅ **Key Validation**: Tests invalid key formats and lengths
- ✅ **Message Integrity**: Tests tampered messages and wrong keys
- ✅ **Challenge Security**: Tests expired and invalid challenges

### Edge Cases

- ✅ **Large Messages**: Tests message size limits
- ✅ **Concurrent Connections**: Multiple devices per user
- ✅ **Message Ordering**: Chronological message delivery
- ✅ **Pagination Edge Cases**: Empty pages, large offsets
- ✅ **Connection Cleanup**: Stale connection handling
- ✅ **Database Constraints**: Unique message IDs, foreign keys

## Adding New Tests

### Test Organization

1. **Unit Tests**: Add to existing test files based on module
2. **New Modules**: Create new test files following naming convention
3. **Integration Tests**: Add complex scenarios to `integration_tests.rs`

### Test Utilities

Use the common test utilities in `tests/common.rs`:

```rust
// Create test setup
let setup = TestSetup::new().await;
setup.cleanup().await;

// Create test identities
let alice = TestIdentity::new();
let bob = TestIdentity::new();

// Create auth headers
let auth_header = AuthHelper::create_auth_header(&alice, &setup.config.challenge_key).await;

// Create test messages
let (message_id, eph_key, encrypted, nonce, signature) = 
    MessageHelper::create_test_message(&alice, &bob, "Test message");
```

### Best Practices

1. **Cleanup**: Always call `setup.cleanup().await` to reset state
2. **Assertions**: Use descriptive assertion messages
3. **Error Testing**: Test both success and failure cases
4. **Independence**: Tests should not depend on each other
5. **Realistic Data**: Use realistic key sizes and message formats

## Continuous Integration

The test suite is designed to run in CI environments:

- **Database**: Uses environment variable for connection
- **Isolation**: Each test is independent
- **Performance**: Tests complete quickly (< 30 seconds total)
- **Reliability**: No flaky tests or race conditions

## Debugging Tests

### Common Issues

1. **Database Connection**: Ensure TEST_DATABASE_URL is set correctly
2. **Migration Failures**: Check that migrations are up to date
3. **Timing Issues**: Use `tokio-test` for time-dependent tests
4. **Key Formats**: Ensure test keys match expected formats

### Debug Output

```bash
# Enable debug logging
RUST_LOG=debug cargo test

# Show test output
cargo test -- --nocapture

# Run single test with full output
RUST_LOG=trace cargo test test_full_message_flow -- --nocapture
```

This comprehensive test suite ensures the DM server maintains security, reliability, and correctness as the codebase evolves.
