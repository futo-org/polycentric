import { x25519 } from '@noble/curves/ed25519.js';
import * as Core from '@polycentric/polycentric-core';
import Long from 'long';

export interface DMServerConfig {
  httpUrl: string;
  websocketUrl: string;
}

export interface X25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface EncryptedMessage {
  messageId: string;
  sender: Core.Models.PublicKey.PublicKey;
  recipient: Core.Models.PublicKey.PublicKey;
  ephemeralPublicKey: Uint8Array;
  encryptedContent: Uint8Array;
  nonce: Uint8Array;
  encryptionAlgorithm: string; // 'ChaCha20-Poly1305' or 'AES-GCM'
  timestamp: Date;
  replyTo?: string;
}

export interface DecryptedMessage {
  messageId: string;
  sender: Core.Models.PublicKey.PublicKey;
  content: DMMessageContent;
  timestamp: Date;
  replyTo?: string;
}

export interface DMMessageContent {
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

export interface AuthChallenge {
  challenge: Uint8Array;
  createdOn: number;
}

export interface AuthRequest {
  challenge_response: {
    body: number[];
    hmac: number[];
  };
  identity: {
    key_type: number;
    key_bytes: number[];
  };
  signature: number[];
}

/**
 * Client for interacting with the Polycentric DM server
 */
export class DMClient {
  private config: DMServerConfig;
  private processHandle: Core.ProcessHandle.ProcessHandle;
  private x25519KeyPair: X25519KeyPair | null = null;
  private websocket: WebSocket | null = null;
  private messageHandlers: ((message: EncryptedMessage) => void)[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];

  constructor(
    config: DMServerConfig,
    processHandle: Core.ProcessHandle.ProcessHandle,
  ) {
    this.config = config;
    this.processHandle = processHandle;
  }

  /**
   * Generate and register X25519 keypair for DM encryption
   */
  async generateAndRegisterKeys(): Promise<void> {
    // Generate X25519 keypair using WebCrypto or a crypto library
    const keyPair = await this.generateX25519KeyPair();
    this.x25519KeyPair = keyPair;

    // Sign the public key with our identity key
    const signature = await this.signData(keyPair.publicKey);

    // Register with the server
    const authHeader = await this.createAuthHeader();

    const response = await fetch(`${this.config.httpUrl}/register_key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        x25519_public_key: Array.from(keyPair.publicKey),
        signature: Array.from(signature),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register keys: ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(`Key registration failed: ${result.error}`);
    }
  }

  /**
   * Get another user's X25519 public key
   */
  async getUserKey(
    identity: Core.Models.PublicKey.PublicKey,
  ): Promise<Uint8Array | null> {
    const response = await fetch(`${this.config.httpUrl}/get_key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identity: {
          key_type: identity.keyType.toNumber(),
          key_bytes: Array.from(identity.key),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get user key: ${response.statusText}`);
    }

    const result = await response.json();
    if (result.found) {
      return new Uint8Array(result.x25519_public_key);
    }
    return null;
  }

  /**
   * Send an encrypted direct message
   */
  async sendMessage(
    recipient: Core.Models.PublicKey.PublicKey,
    content: DMMessageContent,
    replyTo?: string,
  ): Promise<string> {
    if (!this.x25519KeyPair) {
      throw new Error(
        'X25519 keypair not generated. Call generateAndRegisterKeys() first.',
      );
    }

    // Get recipient's public key
    const recipientKey = await this.getUserKey(recipient);
    if (!recipientKey) {
      throw new Error('Recipient has not registered for DMs');
    }



    // Generate ephemeral keypair
    const ephemeralKeyPair = await this.generateX25519KeyPair();
    


    // Encrypt the message content
    const messageBytes = new TextEncoder().encode(JSON.stringify(content));

    
    const { encrypted, nonce, algorithm } = await this.encryptMessage(
      messageBytes,
      ephemeralKeyPair.privateKey,
      recipientKey,
    );

    const messageId = this.generateMessageId();

    // Create message data for signing - MUST match server's exact structure
    // The server uses serde_json::to_vec() with this exact JSON structure
    const messageForSigning = {
      message_id: messageId,
      sender: {
        key_type: this.processHandle.system().keyType.toNumber(),
        key_bytes: Array.from(this.processHandle.system().key),
      },
      recipient: {
        key_type: recipient.keyType.toNumber(),
        key_bytes: Array.from(recipient.key),
      },
      ephemeral_public_key: Array.from(ephemeralKeyPair.publicKey),
      encrypted_content: Array.from(encrypted),
      nonce: Array.from(nonce),
      // Note: timestamp and reply_to are NOT included in signature (server excludes them)
    };



    // CRITICAL: JavaScript and Rust JSON serialization produce different byte representations
    // This causes signature verification to fail. Solution: Use concatenated bytes instead of JSON.
    
    // Create a deterministic byte format that both client and server can use consistently
    // Format: [message_id_bytes][sender_key_type][sender_key_bytes][recipient_key_type][recipient_key_bytes][ephemeral_key][encrypted_content][nonce]
    
    const messageIdBytes = new TextEncoder().encode(messageId);
    const senderKeyType = this.processHandle.system().keyType.toNumber();
    const recipientKeyType = recipient.keyType.toNumber();
    
    // Calculate total size
    const totalSize = messageIdBytes.length + 8 + this.processHandle.system().key.length + 8 + recipient.key.length + ephemeralKeyPair.publicKey.length + encrypted.length + nonce.length;
    
    // Create concatenated message data
    const messageBytes2 = new Uint8Array(totalSize);
    let offset = 0;
    
    // Write message_id (variable length)
    messageBytes2.set(messageIdBytes, offset);
    offset += messageIdBytes.length;
    
    // Write sender key_type (u64, little-endian)
    const senderKeyTypeBytes = new Uint8Array(new BigUint64Array([BigInt(senderKeyType)]).buffer);
    messageBytes2.set(senderKeyTypeBytes, offset);
    offset += 8;
    
    // Write sender key_bytes
    messageBytes2.set(this.processHandle.system().key, offset);
    offset += this.processHandle.system().key.length;
    
    // Write recipient key_type (u64, little-endian)
    const recipientKeyTypeBytes = new Uint8Array(new BigUint64Array([BigInt(recipientKeyType)]).buffer);
    messageBytes2.set(recipientKeyTypeBytes, offset);
    offset += 8;
    
    // Write recipient key_bytes
    messageBytes2.set(recipient.key, offset);
    offset += recipient.key.length;
    
    // Write ephemeral public key
    messageBytes2.set(ephemeralKeyPair.publicKey, offset);
    offset += ephemeralKeyPair.publicKey.length;
    
    // Write encrypted content
    messageBytes2.set(encrypted, offset);
    offset += encrypted.length;
    
    // Write nonce
    messageBytes2.set(nonce, offset);
    

    
    const signature = await this.signData(messageBytes2);

    // Send to server
    const authHeader = await this.createAuthHeader();

    const requestBody = {
      recipient: {
        key_type: recipient.keyType.toNumber(),
        key_bytes: Array.from(recipient.key),
      },
      ephemeral_public_key: Array.from(ephemeralKeyPair.publicKey),
      encrypted_content: Array.from(encrypted),
      nonce: Array.from(nonce),
      encryption_algorithm: algorithm, // Add the encryption algorithm
      message_id: messageId,
      reply_to: replyTo,
      signature: Array.from(signature),
    };



    const response = await fetch(`${this.config.httpUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(`Message send failed: ${result.error}`);
    }

    return messageId;
  }

  /**
   * Get all conversations for the current user
   */
  async getAllConversations(): Promise<{
    conversations: Array<{
      otherParty: Core.Models.PublicKey.PublicKey;
      lastMessage?: DecryptedMessage;
      unreadCount: number;
    }>;
  }> {
    if (!this.x25519KeyPair) {
      throw new Error(
        'X25519 keypair not generated. Call generateAndRegisterKeys() first.',
      );
    }

    const authHeader = await this.createAuthHeader();

    const response = await fetch(`${this.config.httpUrl}/conversations/detailed`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get conversations: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Convert the conversations to include the other party's public key
    const conversations = result.conversations.map((conv: any) => ({
      otherParty: this.parsePublicKey(conv.other_party),
      lastMessage: conv.last_message ? {
        messageId: conv.last_message.message_id,
        sender: this.parsePublicKey(conv.last_message.sender),
        content: conv.last_message.content,
        timestamp: new Date(conv.last_message.timestamp),
        replyTo: conv.last_message.reply_to,
      } : undefined,
      unreadCount: conv.unread_count || 0,
    }));

    return { conversations };
  }

  /**
   * Get DM history with another user
   */
  async getHistory(
    otherParty: Core.Models.PublicKey.PublicKey,
    cursor?: string,
    limit?: number,
  ): Promise<{
    messages: DecryptedMessage[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    if (!this.x25519KeyPair) {
      throw new Error(
        'X25519 keypair not generated. Call generateAndRegisterKeys() first.',
      );
    }

    const authHeader = await this.createAuthHeader();

    const response = await fetch(`${this.config.httpUrl}/history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        other_party: {
          key_type: otherParty.keyType.toNumber(),
          key_bytes: Array.from(otherParty.key),
        },
        cursor,
        limit,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.statusText}`);
    }

    const result = await response.json();
    


    // Decrypt messages
    const decryptedMessages: DecryptedMessage[] = [];
    for (const encMsg of result.messages) {

      try {
        const decrypted = await this.decryptMessage({
          messageId: encMsg.message_id,
          sender: this.parsePublicKey(encMsg.sender),
          recipient: this.parsePublicKey(encMsg.recipient),
          ephemeralPublicKey: new Uint8Array(encMsg.ephemeral_public_key),
          encryptedContent: new Uint8Array(encMsg.encrypted_content),
          nonce: new Uint8Array(encMsg.nonce),
          encryptionAlgorithm: encMsg.encryption_algorithm || 'ChaCha20Poly1305', // Default to ChaCha20-Poly1305 for backward compatibility
          timestamp: new Date(encMsg.timestamp),
          replyTo: encMsg.reply_to,
        });

        decryptedMessages.push(decrypted);
      } catch (error) {
        console.error('Failed to decrypt message:', error);
        console.error('Message details:', encMsg);
        // Skip messages we can't decrypt
      }
    }
    


    return {
      messages: decryptedMessages,
      nextCursor: result.next_cursor,
      hasMore: result.has_more,
    };
  }

  /**
   * Connect to WebSocket for real-time messaging
   */
  async connectWebSocket(): Promise<void> {
    if (this.websocket) {
      this.websocket.close();
    }

    return new Promise((resolve, reject) => {
      this.websocket = new WebSocket(this.config.websocketUrl);

      this.websocket.onopen = async () => {
        try {
          // Authenticate the WebSocket connection
          await this.authenticateWebSocket();
          this.notifyConnectionHandlers(true);
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      this.websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      this.websocket.onclose = () => {
        this.notifyConnectionHandlers(false);
      };

      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
    });
  }

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler: (message: EncryptedMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a handler for connection status changes
   */
  onConnectionChange(handler: (connected: boolean) => void): void {
    this.connectionHandlers.push(handler);
  }

  // Private methods

  private async generateX25519KeyPair(): Promise<X25519KeyPair> {
    // Convert Ed25519 private key to X25519 private key
    // This ensures the same user identity is used for both signing and encryption
    
    const ed25519PrivateKey = this.processHandle.system().key;
    
    // Convert Ed25519 private key to X25519 using the standard conversion
    // Ed25519 private key is 32 bytes, X25519 private key is also 32 bytes
    // We'll use a deterministic conversion based on the Ed25519 key
    
    // Use HKDF to derive X25519 private key from Ed25519 private key
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      ed25519PrivateKey,
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );
    
    const derivedBytes = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        salt: new TextEncoder().encode('polycentric-ed25519-to-x25519'),
        info: new TextEncoder().encode('dm-encryption-key'),
        hash: 'SHA-256',
      },
      keyMaterial,
      256 // 32 bytes for X25519 private key
    );
    
    const privateKey = new Uint8Array(derivedBytes);
    const publicKey = x25519.getPublicKey(privateKey);
    
    
    
    return { privateKey, publicKey };
  }

  private async encryptMessage(
    message: Uint8Array,
    ephemeralPrivateKey: Uint8Array,
    recipientPublicKey: Uint8Array,
  ): Promise<{ encrypted: Uint8Array; nonce: Uint8Array; algorithm: string }> {
    // Validate inputs
    if (!message || !ephemeralPrivateKey || !recipientPublicKey) {
      throw new Error('All parameters must be valid Uint8Arrays');
    }
    
    if (message.length === 0) {
      throw new Error('Message cannot be empty');
    }
    
    if (ephemeralPrivateKey.length !== 32) {
      throw new Error(`Ephemeral private key must be 32 bytes, got ${ephemeralPrivateKey.length}`);
    }
    
    if (recipientPublicKey.length !== 32) {
      throw new Error(`Recipient public key must be 32 bytes, got ${recipientPublicKey.length}`);
    }

    // Generate a random 12-byte nonce for ChaCha20Poly1305
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);

    try {
      // Perform X25519 ECDH key exchange
      const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, recipientPublicKey);
      

      
      if (!sharedSecret || sharedSecret.length === 0) {
        throw new Error('Failed to generate shared secret from X25519 ECDH');
      }
      
      // Ensure sharedSecret is a proper Uint8Array
      const sharedSecretArray = new Uint8Array(sharedSecret);
      

      
      // Use HKDF to derive encryption key from shared secret
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        sharedSecretArray,
        { name: 'HKDF' },
        false,
        ['deriveKey']
      );
      
      // Try ChaCha20-Poly1305 first, fallback to AES-GCM if not supported
      let encryptionKey;
      let algorithmName;
      
      // Try ChaCha20-Poly1305 first, fallback to AES-GCM if not supported
      try {
        encryptionKey = await crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            salt: new Uint8Array(0), // No salt
            info: new TextEncoder().encode('dm-encryption-key'),
            hash: 'SHA-256',
          },
          keyMaterial,
          { name: 'ChaCha20-Poly1305', length: 256 },
          false,
          ['encrypt']
        );
        algorithmName = 'ChaCha20-Poly1305';

      } catch (error) {

        // Fallback to AES-GCM (more widely supported)
        encryptionKey = await crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            salt: new Uint8Array(0), // No salt
            info: new TextEncoder().encode('dm-encryption-key-aes'),
            hash: 'SHA-256',
          },
          keyMaterial,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt']
        );
        algorithmName = 'Aes256Gcm';
      }



      // Encrypt the message using the available algorithm
      let encrypted;
      if (algorithmName === 'ChaCha20-Poly1305') {
        encrypted = await crypto.subtle.encrypt(
          {
            name: 'ChaCha20-Poly1305',
            iv: nonce,
          },
          encryptionKey,
          message
        );
      } else if (algorithmName === 'Aes256Gcm') {
        // AES-GCM uses 12-byte nonce, but we need to ensure compatibility
        const aesNonce = nonce.slice(0, 12); // AES-GCM uses 12-byte nonce
        encrypted = await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: aesNonce,
          },
          encryptionKey,
          message
        );
      } else {
        throw new Error(`Unsupported encryption algorithm: ${algorithmName}`);
      }

      return { encrypted: new Uint8Array(encrypted), nonce, algorithm: algorithmName };
    } catch (error) {
      console.error('Encryption failed:', error);
      console.error('Message length:', message.length);
      console.error('Ephemeral private key length:', ephemeralPrivateKey.length);
      console.error('Recipient public key length:', recipientPublicKey.length);
      throw error;
    }
  }

    private async decryptMessage(
    encryptedMsg: EncryptedMessage,
  ): Promise<DecryptedMessage> {
    if (!this.x25519KeyPair) {
      throw new Error('No X25519 keypair available for decryption');
    }



    // CRITICAL: Check if we're using the right keys

    // Perform X25519 ECDH key exchange with sender's ephemeral key
    const sharedSecret = x25519.getSharedSecret(
      this.x25519KeyPair.privateKey,
      encryptedMsg.ephemeralPublicKey
    );
    

    
    // Use HKDF to derive decryption key from shared secret
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'HKDF' },
      false,
      ['deriveKey']
    );
    
    // Use the algorithm from the message to determine decryption method
    const algorithm = encryptedMsg.encryptionAlgorithm;

    
    let decryptionKey;
    let algorithmName: string;
    
    try {
      if (algorithm === 'ChaCha20-Poly1305') {
        // Use ChaCha20-Poly1305
        decryptionKey = await crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            salt: new Uint8Array(0), // No salt
            info: new TextEncoder().encode('dm-encryption-key'),
            hash: 'SHA-256',
          },
          keyMaterial,
          { name: 'ChaCha20-Poly1305', length: 256 },
          false,
          ['decrypt']
        );
        algorithmName = 'ChaCha20-Poly1305';

      } else if (algorithm === 'Aes256Gcm') {
        // Use AES-GCM
        decryptionKey = await crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            salt: new Uint8Array(0), // No salt
            info: new TextEncoder().encode('dm-encryption-key-aes'),
            hash: 'SHA-256',
          },
          keyMaterial,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
        algorithmName = 'Aes256Gcm';

      } else {
        throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
      }
    } catch (error) {
      console.error('Failed to derive decryption key:', error);
      throw error;
    }

    // Decrypt the message using the available algorithm
    let decrypted;
    try {
      if (algorithmName === 'ChaCha20-Poly1305') {
        decrypted = await crypto.subtle.decrypt(
          {
            name: 'ChaCha20-Poly1305',
            iv: encryptedMsg.nonce,
          },
          decryptionKey,
          encryptedMsg.encryptedContent
        );
      } else {
        // AES-GCM uses 12-byte nonce
        const aesNonce = encryptedMsg.nonce.slice(0, 12);
        decrypted = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: aesNonce,
          },
          decryptionKey,
          encryptedMsg.encryptedContent
        );
      }
    } catch (decryptError) {
      console.error('Decryption failed with algorithm:', algorithmName);
      console.error('Decryption error details:', decryptError);
      throw decryptError;
    }

    const content: DMMessageContent = JSON.parse(
      new TextDecoder().decode(decrypted),
    );

    return {
      messageId: encryptedMsg.messageId,
      sender: encryptedMsg.sender,
      content,
      timestamp: encryptedMsg.timestamp,
      replyTo: encryptedMsg.replyTo,
    };
  }

  private async signData(data: Uint8Array): Promise<Uint8Array> {
    // Use the process handle to sign data
    return await Core.Models.PrivateKey.sign(
      this.processHandle.processSecret().system,
      data,
    );
  }

  private async createAuthHeader(): Promise<string> {
    // Get challenge from server
    const challengeResponse = await fetch(`${this.config.httpUrl}/challenge`);
    if (!challengeResponse.ok) {
      throw new Error('Failed to get challenge');
    }

    const challengeData = await challengeResponse.json();

    // Parse the challenge body to extract the actual challenge
    const challengeBodyBytes = new Uint8Array(challengeData.body);
    const challengeBodyText = new TextDecoder().decode(challengeBodyBytes);
    const challengeBody = JSON.parse(challengeBodyText);
    
    // The challenge is in the challengeBody.challenge field
    const challenge = new Uint8Array(challengeBody.challenge);
    const signature = await this.signData(challenge);

    const authRequest: AuthRequest = {
      challenge_response: {
        body: Array.from(challengeData.body),
        hmac: Array.from(challengeData.hmac),
      },
      identity: {
        key_type: this.processHandle.system().keyType.toNumber(),
        key_bytes: Array.from(this.processHandle.system().key),
      },
      signature: Array.from(signature),
    };

    // Use a more robust base64 encoding method
    const jsonString = JSON.stringify(authRequest);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(jsonString);
    const base64 = btoa(String.fromCharCode(...bytes));
    return `Bearer ${base64}`;
  }

  private async authenticateWebSocket(): Promise<void> {
    // WebSocket authentication would be implemented here
    // Similar to HTTP auth but over WebSocket
  }

  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.type === 'dm_message') {
        const encryptedMsg: EncryptedMessage = {
          messageId: message.message.message_id,
          sender: this.parsePublicKey(message.message.sender),
          recipient: this.parsePublicKey(message.message.recipient),
          ephemeralPublicKey: new Uint8Array(
            message.message.ephemeral_public_key,
          ),
          encryptedContent: new Uint8Array(message.message.encrypted_content),
          nonce: new Uint8Array(message.message.nonce),
          encryptionAlgorithm: message.message.encryption_algorithm || 'ChaCha20Poly1305', // Default to ChaCha20-Poly1305 for backward compatibility
          timestamp: new Date(message.message.timestamp),
          replyTo: message.message.reply_to,
        };

        this.messageHandlers.forEach((handler) => handler(encryptedMsg));
      }
    } catch (error) {
      console.error('Failed to handle WebSocket message:', error);
    }
  }

  private parsePublicKey(keyData: any): Core.Models.PublicKey.PublicKey {
    return Core.Models.PublicKey.fromProto({
      keyType: Long.fromNumber(keyData.key_type),
      key: new Uint8Array(keyData.key_bytes),
    });
  }

  private notifyConnectionHandlers(connected: boolean): void {
    this.connectionHandlers.forEach((handler) => handler(connected));
  }

  private generateMessageId(): string {
    return `dm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
