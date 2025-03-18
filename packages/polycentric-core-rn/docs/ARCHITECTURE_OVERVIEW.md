# Polycentric Architecture Overview

This document provides a comprehensive overview of the Polycentric architecture,
focusing on the responsibilities and relationships between key components:
`polycentric-protocol`, `server`, and `polycentric-core`.

## Component Responsibilities

### 1. polycentric-protocol

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

### 2. server

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

### 3. polycentric-core

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

## Architecture Relationships

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

## Communication Flow

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

