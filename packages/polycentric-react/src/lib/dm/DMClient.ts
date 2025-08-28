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
  challengeResponse: {
    body: Uint8Array;
    hmac: Uint8Array;
  };
  identity: Core.Models.PublicKey.PublicKey;
  signature: Uint8Array;
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
    const { encrypted, nonce } = await this.encryptMessage(
      messageBytes,
      ephemeralKeyPair.privateKey,
      recipientKey,
    );

    const messageId = this.generateMessageId();

    // Create message object for signing
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
      timestamp: new Date().toISOString(),
      reply_to: replyTo,
    };

    // Sign the message
    const messageBytes2 = new TextEncoder().encode(
      JSON.stringify(messageForSigning),
    );
    const signature = await this.signData(messageBytes2);

    // Send to server
    const authHeader = await this.createAuthHeader();

    const response = await fetch(`${this.config.httpUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        recipient: {
          key_type: recipient.keyType.toNumber(),
          key_bytes: Array.from(recipient.key),
        },
        ephemeral_public_key: Array.from(ephemeralKeyPair.publicKey),
        encrypted_content: Array.from(encrypted),
        nonce: Array.from(nonce),
        message_id: messageId,
        reply_to: replyTo,
        signature: Array.from(signature),
      }),
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
          timestamp: new Date(encMsg.timestamp),
          replyTo: encMsg.reply_to,
        });
        decryptedMessages.push(decrypted);
      } catch (error) {
        console.error('Failed to decrypt message:', error);
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
    // This would typically use a crypto library like tweetnacl or @noble/curves
    // For now, returning a placeholder - implement with actual X25519 generation
    const privateKey = new Uint8Array(32);
    crypto.getRandomValues(privateKey);

    // This is a placeholder - implement actual X25519 public key derivation
    const publicKey = new Uint8Array(32);
    crypto.getRandomValues(publicKey);

    return { privateKey, publicKey };
  }

  private async encryptMessage(
    message: Uint8Array,
    ephemeralPrivateKey: Uint8Array,
    recipientPublicKey: Uint8Array,
  ): Promise<{ encrypted: Uint8Array; nonce: Uint8Array }> {
    // Implement X25519 ECDH + ChaCha20Poly1305 encryption
    // This is a placeholder - implement actual encryption
    const nonce = new Uint8Array(24);
    crypto.getRandomValues(nonce);

    // Placeholder encryption
    const encrypted = new Uint8Array(message.length + 16); // + auth tag
    encrypted.set(message);

    return { encrypted, nonce };
  }

  private async decryptMessage(
    encryptedMsg: EncryptedMessage,
  ): Promise<DecryptedMessage> {
    if (!this.x25519KeyPair) {
      throw new Error('No X25519 keypair available for decryption');
    }

    // Implement X25519 ECDH + ChaCha20Poly1305 decryption
    // This is a placeholder - implement actual decryption
    const decrypted = encryptedMsg.encryptedContent.slice(0, -16); // Remove auth tag

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

    // Sign the challenge
    const challenge = new Uint8Array(challengeData.body);
    const signature = await this.signData(challenge);

    const authRequest: AuthRequest = {
      challengeResponse: challengeData,
      identity: this.processHandle.system(),
      signature,
    };

    return `Bearer ${btoa(JSON.stringify(authRequest))}`;
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
